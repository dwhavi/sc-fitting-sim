#!/usr/bin/env python3
"""sc-fitting-sim — scunpacked 원본 동기화 (패치 갱신 1단계)

출처: StarCitizenWiki/scunpacked-data (게임 파일 덤프, 패치마다 갱신됨)
받는 곳: data/raw/  — 프리스틴 원본. 가공물(기존 data/*.json)은 건드리지 않는다.

  data/raw/ships/<file>.json     함선별 (슬롯 Loadout + Crew/Cargo + 성능)
  data/raw/ship-items.json       부품 성능치 (장착 가능 아이템)
  data/raw/labels.json           현지화 라벨
  data/raw/manufacturers.json    제조사
  data/raw/ship_files.json       저장소의 함선 파일 목록 (이름 드리프트 대응)
  data/raw/.sync_meta.json       커밋 SHA + 매핑 결과

★ 함선 파일명은 패치마다 바뀐다 (실측 2026-10-29):
    RSI_Aurora_CL → rsi_aurora_cl.json   ✗ (이제 없음)
                    rsi_aurora_gs_cl.json ✓
    AEGS_Idris    → aegs_idris.json      ✗
                    aegs_idris_m/_p.json  ✓ (모호 → 이름으로 판별)
    ANVL_Hornet_F7A → anvl_hornet_f7a_mk1/_mk2.json  ✓
  그래서 db.json 의 class 로 파일명을 추측하지 않고, 저장소 목록에서 해석한다.

사용:
  python3 sync_data.py              # db.json 함선만 (기본)
  python3 sync_data.py --all        # 저장소 전체 함선
  python3 sync_data.py --rebuild    # 이미 있어도 다시 받음
  python3 sync_data.py --check      # 다운로드 없이 새 패치만 확인
"""
import json, io, os, re, sys, time, urllib.request

ROOT = os.path.dirname(os.path.abspath(__file__))
RAW = os.path.join(ROOT, 'data', 'raw')
META = os.path.join(RAW, '.sync_meta.json')
FILELIST = os.path.join(RAW, 'ship_files.json')
REPO = 'StarCitizenWiki/scunpacked-data'
BRANCH = 'master'
BASE = f'https://raw.githubusercontent.com/{REPO}/{BRANCH}'
UA = {'User-Agent': 'curl/8'}

BULK = ['ship-items.json', 'labels.json', 'manufacturers.json']


def fetch(url, headers=None, timeout=60):
    req = urllib.request.Request(url, headers={**UA, **(headers or {})})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read()


def api(url, tries=3):
    """GitHub API — 시간당 60회 제한. 실패하면 None."""
    for i in range(tries):
        try:
            return json.loads(fetch(url, {'Accept': 'application/vnd.github+json'}))
        except Exception:
            if i == tries - 1:
                return None
            time.sleep(2 * (i + 1))


def remote_sha():
    j = api(f'https://api.github.com/repos/{REPO}/commits?sha={BRANCH}&per_page=1')
    if not j:
        return None, None
    return j[0]['sha'], j[0]['commit']['committer']['date']


def ship_file_list(rebuild=False):
    """저장소 ships/ 디렉터리의 파일명 목록. API 레이트리밋을 피해 HTML 에서 긁는다."""
    if os.path.exists(FILELIST) and not rebuild:
        c = json.load(io.open(FILELIST, encoding='utf-8'))
        if c.get('files'):
            return c['files']
    # 1순위: git tree API (1회 호출)
    j = api(f'https://api.github.com/repos/{REPO}/git/trees/{BRANCH}?recursive=1')
    files = []
    if isinstance(j, dict) and j.get('tree'):
        files = sorted(x['path'].split('/')[-1] for x in j['tree']
                       if x['path'].startswith('ships/') and x['path'].endswith('.json'))
    if not files:
        # 2순위: HTML 트리 페이지 스크레이프 (API 제한 우회)
        h = fetch(f'https://github.com/{REPO}/tree/{BRANCH}/ships').decode('utf-8', 'replace')
        files = sorted(set(re.findall(r'ships/([a-z0-9_]+\.json)', h)))
    if files:
        os.makedirs(RAW, exist_ok=True)
        json.dump({'files': files, 'fetched': time.strftime('%Y-%m-%dT%H:%M:%S')},
                  io.open(FILELIST, 'w', encoding='utf-8'), indent=2)
    return files


def resolve(klass, files):
    """db.json 의 class -> 저장소 파일명. 모호하면 후보 목록을 함께 돌려준다.

    패치가 게임 파일명의 토큰을 재배열/추가하기 때문에 단순 prefix 로는 못 찾는다:
      RSI_Aurora_CL -> rsi_aurora_gs_cl.json   (중간에 'gs' 삽입)
      AEGS_Idris    -> aegs_idris_m / _p       (접미 변형, 모호)
      ANVL_Hornet_F7A -> anvl_hornet_f7a_mk1/_mk2
    그래서 1) 완전일치 → 2) 토큰 상위집합(추가 토큰 최소) → 3) 모호는 호출측이 이름으로 판별.
    """
    low = klass.lower()
    want = f'{low}.json'
    if want in files:
        return want, []

    toks = set(low.split('_'))
    head = low.split('_')[0]                 # 제조사 토큰 (aegs/rsi/anvl/…)
    hits = []
    for f in files:
        stem = f[:-5]
        if stem.split('_')[0] != head:       # 같은 제조사 계열만
            continue
        ftoks = set(stem.split('_'))
        if toks <= ftoks:
            hits.append((len(ftoks - toks), f))   # 추가 토큰이 적을수록 우선
    hits.sort()
    if len(hits) == 1:
        return hits[0][1], []
    if hits and hits[0][0] < hits[1][0]:       # 추가 토큰 수가 다르면 최소쪽이 정답
        return hits[0][1], []
    if hits:
        return None, [f for _, f in hits]       # 동률 — 모호
    return None, []


def pick_by_name(cands, db_name, files):
    """모호한 후보 중 파일 안의 Name 이 db 이름과 가장 잘 맞는 것을 고른다."""
    target = re.sub(r'[^a-z0-9]', '', (db_name or '').lower())
    best, best_score = None, -1
    for c in cands:
        if c not in files:
            continue
        try:
            d = json.loads(fetch(f'{BASE}/ships/{c}'))
        except Exception:
            continue
        nm = re.sub(r'[^a-z0-9]', '', (d.get('Name') or '').lower())
        score = 0
        if nm and nm == target:
            score = 100
        elif nm and target and (nm in target or target in nm):
            score = 50 + min(len(nm), len(target)) / max(len(nm), len(target), 1)
        if score > best_score:
            best, best_score = c, score
    return best or cands[0]


def get(remote, dest, rebuild=False):
    """1개 파일 받기. 이미 있고 rebuild 아니면 skip. -> 'skip'|'ok'|'fail'"""
    if os.path.exists(dest) and not rebuild and os.path.getsize(dest) > 1000:
        return 'skip'
    os.makedirs(os.path.dirname(dest), exist_ok=True)
    try:
        data = fetch(f'{BASE}/{remote}')
        if len(data) < 100:          # 404 페이지 등
            return 'fail'
        with open(dest, 'wb') as f:
            f.write(data)
        return 'ok'
    except Exception:
        return 'fail'


def db_ships():
    db = json.load(io.open(os.path.join(ROOT, 'public', 'db.json'), encoding='utf-8'))
    return db['ships']


def main():
    args = set(sys.argv[1:])
    rebuild = '--rebuild' in args
    check_only = '--check' in args
    all_ships = '--all' in args

    os.makedirs(RAW, exist_ok=True)
    sha, date = remote_sha()
    prev = json.load(io.open(META, encoding='utf-8')) if os.path.exists(META) else {}

    print(f'원본: {REPO}')
    if sha:
        print(f'  최신 커밋: {sha[:10]}  ({date})')
        if prev.get('commit'):
            same = prev['commit'] == sha
            print(f'  이전 동기화: {prev["commit"][:10]}  → '
                  f'{"변경 없음" if same else "★ 새 패치 있음"}')
            if same and check_only:
                print('\n새 패치 없음. 종료.')
                return
        elif check_only:
            print('  (이전 기록 없음 — 첫 동기화 필요)')
    else:
        print('  ⚠️ 커밋 조회 실패(API 레이트리밋) — 기존 기록 유지')

    if check_only:
        print('\n다운로드하려면 --check 없이 실행하세요.')
        return

    bulk_failed = []
    for name in BULK:
        st = get(name, os.path.join(RAW, name), rebuild)
        if st == 'fail':
            bulk_failed.append(name)
        print(f'  [{st:4}] {name}')

    files = ship_file_list(rebuild)
    print(f'\n저장소 함선 파일: {len(files)}개')

    if all_ships:
        targets = [(f[:-5], f) for f in files]
    else:
        targets = []
        unresolved = []
        for s in db_ships():
            f, cands = resolve(s['class'], files)
            if not f and cands:
                f = pick_by_name(cands, s['name'], files)
                print(f'  [모호해결] {s["class"]} -> {f}  (후보 {len(cands)})')
            if f:
                targets.append((s['class'], f))
            else:
                unresolved.append(s['class'])
        if unresolved:
            print(f'  ⚠️ 파일 못 찾음 {len(unresolved)}척: {unresolved}')

    print(f'함선 {len(targets)}척 동기화 중…')
    n_ok = n_skip = 0
    failed = []
    mapping = {}
    for i, (klass, fn) in enumerate(targets, 1):
        mapping[klass] = fn
        st = get(f'ships/{fn}', os.path.join(RAW, 'ships', fn), rebuild)
        if st == 'fail':
            failed.append(fn)
        elif st == 'ok':
            n_ok += 1
        else:
            n_skip += 1
        if i % 40 == 0 or i == len(targets):
            print(f'  {i}/{len(targets)}  (신규 {n_ok} · 기존 {n_skip} · 실패 {len(failed)})')
        time.sleep(0.05)

    if sha or prev:
        json.dump({'commit': sha or prev.get('commit'), 'date': date or prev.get('date'),
                   'synced': time.strftime('%Y-%m-%dT%H:%M:%S'),
                   'ship_files_available': len(files),
                   'ships_total': len(targets), 'ships_ok': n_ok, 'ships_skip': n_skip,
                   'ships_failed': failed[:50], 'bulk_failed': bulk_failed,
                   'class_to_file': mapping},
                  io.open(META, 'w', encoding='utf-8'), ensure_ascii=False, indent=2)

    print(f'\n완료 — 커밋 {(sha or "?")[:10]}')
    print(f'  함선: 신규 {n_ok} · 기존 {n_skip} · 실패 {len(failed)}')
    if bulk_failed or failed:
        print(f'  ⚠️ 실패: {bulk_failed + failed[:10]}')
    print('  기록: data/raw/.sync_meta.json')


if __name__ == '__main__':
    main()
