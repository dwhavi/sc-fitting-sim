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
  python3 sync_data.py --rebuild    # 호환 옵션: 모든 동기화는 전체 재검증
  python3 sync_data.py --check      # 다운로드 없이 새 패치만 확인
"""
import json, io, os, re, sys, time, urllib.request, tempfile, shutil

ROOT = os.path.dirname(os.path.abspath(__file__))
RAW = os.path.join(ROOT, 'data', 'raw')
META = os.path.join(RAW, '.sync_meta.json')
FILELIST = os.path.join(RAW, 'ship_files.json')
REPO = 'StarCitizenWiki/scunpacked-data'
BRANCH = 'master'
BASE = f'https://raw.githubusercontent.com/{REPO}/{BRANCH}'
UA = {'User-Agent': 'curl/8'}

BULK = ['items.json', 'labels.json', 'manufacturers.json']


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
    """-> (sha, date, version). version은 커밋 메시지의 빌드 태그 (4.10.3-LIVE.13165946)."""
    j = api(f'https://api.github.com/repos/{REPO}/commits?sha={BRANCH}&per_page=1')
    if not j:
        return None, None, None
    msg = (j[0]['commit'].get('message') or '').split('\n')[0]
    m = re.match(r'^(\d+\.\d+\.\d+-[A-Z]+\.\d+)', msg)
    return j[0]['sha'], j[0]['commit']['committer']['date'], (m.group(1) if m else None)


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
    best, best_score, tied = None, -1, False
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
            best, best_score, tied = c, score, False
        elif score == best_score:
            tied = True
    return best if best_score > 0 and not tied else None


def get(remote, dest, rebuild=False):
    """1개 파일 받기. 이미 있고 rebuild 아니면 skip. -> 'skip'|'ok'|'fail'"""
    if os.path.exists(dest) and not rebuild and os.path.getsize(dest) > 1000:
        return 'skip'
    os.makedirs(os.path.dirname(dest), exist_ok=True)
    try:
        data = fetch(f'{BASE}/{remote}')
        if len(data) < 100:          # 404 페이지 등
            return 'fail'
        json.loads(data)  # Reject error pages / truncated JSON before saving.
        with open(dest, 'wb') as f:
            f.write(data)
        return 'ok'
    except Exception:
        return 'fail'


def db_ships():
    db = json.load(io.open(os.path.join(ROOT, 'public', 'db.json'), encoding='utf-8'))
    return db['ships']


def main():
    global RAW, META, FILELIST, BASE
    args = set(sys.argv[1:])
    sha, date, version = remote_sha()
    print(f'원본: {REPO} / {sha} / {version}')
    if not sha or not version or '-LIVE.' not in version:
        raise SystemExit('LIVE 원본 버전 확인 실패. 기존 스냅샷을 유지합니다.')
    prev = json.load(io.open(META, encoding='utf-8')) if os.path.exists(META) else {}
    if '--check' in args:
        print('변경 없음' if prev.get('commit') == sha else '동기화 필요')
        return

    # Pin every request, including ambiguous ship-name lookups, to ONE commit.
    # Stage a complete snapshot; never label stale / partial files as a new patch.
    original_raw = RAW
    parent = os.path.dirname(RAW)
    os.makedirs(parent, exist_ok=True)
    stage = tempfile.mkdtemp(prefix='.raw-sync-', dir=parent)
    BASE = f'https://raw.githubusercontent.com/{REPO}/{sha}'
    RAW, META, FILELIST = stage, os.path.join(stage, '.sync_meta.json'), os.path.join(stage, 'ship_files.json')
    try:
        for name in BULK:
            if get(name, os.path.join(stage, name), True) != 'ok':
                raise RuntimeError(f'원본 다운로드 실패: {name}')
        # The file listing is also pinned, not the moving master branch.
        tree = api(f'https://api.github.com/repos/{REPO}/git/trees/{sha}?recursive=1')
        if not isinstance(tree, dict) or tree.get('truncated'):
            raise RuntimeError('함선 목록을 검증할 수 없습니다.')
        files = sorted(x['path'].split('/')[-1] for x in tree.get('tree', [])
                       if x['path'].startswith('ships/') and x['path'].endswith('.json'))
        if not files:
            raise RuntimeError('함선 목록이 비었습니다.')
        json.dump({'files': files, 'commit': sha}, io.open(FILELIST, 'w', encoding='utf-8'))
        targets, unresolved = [], []
        if '--all' in args:
            targets = [(f[:-5], f) for f in files]
        else:
            for ship in db_ships():
                f, cands = resolve(ship['class'], files)
                if not f and cands:
                    f = pick_by_name(cands, ship['name'], files)
                if not f:
                    unresolved.append(ship['class'])
                else:
                    targets.append((ship['class'], f))
        if unresolved:
            raise RuntimeError(f'함선 파일 미해결: {unresolved}')
        mapping = {}
        for i, (klass, fn) in enumerate(targets, 1):
            if get(f'ships/{fn}', os.path.join(stage, 'ships', fn), True) != 'ok':
                raise RuntimeError(f'함선 다운로드 실패: {fn}')
            mapping[klass] = fn
            if i % 40 == 0 or i == len(targets):
                print(f'함선 {i}/{len(targets)}')
        json.dump({'commit': sha, 'date': date, 'version': version,
                   'complete': True, 'synced': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),
                   'ship_files_available': len(files), 'ships_total': len(targets),
                   'ships_ok': len(targets), 'ships_skip': 0, 'ships_failed': [],
                   'bulk_failed': [], 'class_to_file': mapping},
                  io.open(META, 'w', encoding='utf-8'), ensure_ascii=False, indent=2)
        backup = original_raw + '.previous'
        if os.path.exists(backup):
            raise RuntimeError('이전 백업이 있습니다. data/raw.previous 확인이 필요합니다.')
        if os.path.exists(original_raw):
            os.replace(original_raw, backup)
        try:
            os.replace(stage, original_raw)
        except Exception:
            if os.path.exists(backup):
                os.replace(backup, original_raw)
            raise
        if os.path.exists(backup):
            shutil.rmtree(backup)
        print(f'완료: {version}, {len(targets)}척 (커밋 고정·전체 검증)')
    finally:
        RAW = original_raw
        META, FILELIST = os.path.join(RAW, '.sync_meta.json'), os.path.join(RAW, 'ship_files.json')
        if os.path.exists(stage):
            shutil.rmtree(stage)


if __name__ == '__main__':
    main()
