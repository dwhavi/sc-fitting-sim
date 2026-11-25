import json, urllib.request, urllib.error, secrets

U = 'https://sijnasvcvyafxalwqdsp.supabase.co'
ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNpam5hc3ZjdnlhZnhhbHdxZHNwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTU1NjcyNTYsImV4cCI6MjExMTE0MzI1Nn0.RaLAWvBC7XhBUZAw6VFV6CfCiUwCpQbaAHgobBUT2JM'
import os
SVC = os.environ['SUPABASE_SERVICE_ROLE_KEY']

def call(method, path, key, body=None, extra=None, apikey=None):
    req = urllib.request.Request(U + path, method=method)
    req.add_header('apikey', apikey or ANON)
    req.add_header('Authorization', 'Bearer ' + key)
    req.add_header('Content-Type', 'application/json')
    if extra:
        for k, v in extra.items(): req.add_header(k, v)
    data = json.dumps(body).encode() if body is not None else None
    try:
        with urllib.request.urlopen(req, data) as r:
            t = r.read().decode()
            return r.status, json.loads(t) if t else None
    except urllib.error.HTTPError as e:
        t = e.read().decode()
        try: return e.code, json.loads(t)
        except Exception: return e.code, t

# idempotent: remove prior test users
_, users = call('GET', '/auth/v1/admin/users?page=1&per_page=50', SVC, apikey=SVC)
for u in users.get('users', []):
    if u.get('email','').startswith('scfit-test-'):
        call('DELETE', f"/auth/v1/admin/users/{u['id']}", SVC, apikey=SVC)

pwA = secrets.token_urlsafe(12); pwB = secrets.token_urlsafe(12)
open('/tmp/testpw.txt','w').write(pwA+'\n'+pwB)

_, ua = call('POST', '/auth/v1/admin/users', SVC, {'email':'scfit-test-a@example.com','password':pwA,'email_confirm':True}, apikey=SVC)
_, ub = call('POST', '/auth/v1/admin/users', SVC, {'email':'scfit-test-b@example.com','password':pwB,'email_confirm':True}, apikey=SVC)
idA, idB = ua['id'], ub['id']
_, ta = call('POST', '/auth/v1/token?grant_type=password', ANON, {'email':'scfit-test-a@example.com','password':pwA})
_, tb = call('POST', '/auth/v1/token?grant_type=password', ANON, {'email':'scfit-test-b@example.com','password':pwB})
tokA, tokB = ta['access_token'], tb['access_token']
print('users ok:', idA[:8], idB[:8])


# idempotent: remove prior test groups
call('DELETE', "/rest/v1/groups?name=like.%ED%85%8C%EC%8A%A4%ED%8A%B8*", SVC, apikey=SVC)

_, g = call('POST', '/rest/v1/groups', SVC, {'name':'테스트그룹1'}, {'Prefer':'return=representation'}, apikey=SVC)
gid = g[0]['id']
call('POST', '/rest/v1/discord_role_mappings', SVC, {'guild_id':'test-guild-1','discord_role_id':'test-role-1','discord_role_name':'테스트역할','group_id':gid}, apikey=SVC)
call('POST', '/rest/v1/member_discord_roles', SVC, {'user_id':idA,'guild_id':'test-guild-1','discord_role_id':'test-role-1'}, apikey=SVC)
call('POST', '/rest/v1/member_guild_checks', SVC, {'user_id':idA,'guild_id':'test-guild-1','is_member':True}, apikey=SVC)
call('POST', '/rest/v1/member_guild_checks', SVC, {'user_id':idB,'guild_id':'test-guild-1','is_member':True}, apikey=SVC)

s, p = call('POST', '/rest/v1/fittings', tokA, {'ship_slug':'aegs-avenger-stalker','name':'테스트 공개 피팅','payload':{'x':1}}, {'Prefer':'return=representation'})
pid = p[0]['id']; print('A insert public:', s)
_, r = call('POST', '/rest/v1/fittings', SVC, {'author_id':idB,'ship_slug':'aegs-avenger-titan','name':'테스트 제한 피팅','payload':{'x':2},'visibility':'groups'}, {'Prefer':'return=representation'}, apikey=SVC)
rid = r[0]['id']
call('POST', '/rest/v1/fitting_groups', SVC, {'fitting_id':rid,'group_id':gid}, apikey=SVC)

R = []
def t(name, expect, got):
    ok = expect(got)
    R.append(('PASS' if ok else 'FAIL', name, got if not ok else ''))

s, d = call('GET', '/rest/v1/fittings?select=id,name', ANON)
t('anon은 공개 피팅만', lambda d: [x['id'] for x in d]==[pid], d)
s, d = call('GET', '/rest/v1/fittings?select=id,name', tokA)
t('A(신선 역할) 직접 select도 공개만', lambda d: [x['id'] for x in d]==[pid], d)
s, d = call('GET', '/rest/v1/fittings?select=id,name', tokB)
t('B(제한 피팅 작성자) 직접 select도 공개만', lambda d: [x['id'] for x in d]==[pid], d)
s, d = call('PATCH', f'/rest/v1/fittings?id=eq.{rid}', tokB, {'visibility':'public'}, {'Prefer':'return=representation'})
t('B가 제한 피팅 공개 전환 시도 → 0행', lambda sd: sd[1]==[], (s,d))
s, d = call('DELETE', f'/rest/v1/fittings?id=eq.{rid}', tokB, extra={'Prefer':'return=representation'})
t('B가 제한 피팅 삭제 시도 → 0행', lambda sd: sd[1]==[], (s,d))
s, d = call('GET', f'/rest/v1/fitting_groups?select=group_id&fitting_id=eq.{rid}', tokA)
t('A는 제한 피팅의 그룹 메타데이터 조회 가능', lambda d: len(d)==1, d)
s, d = call('GET', f'/rest/v1/fitting_groups?select=group_id&fitting_id=eq.{rid}', tokB)
t('B(역할 없음)는 그룹 메타데이터도 빈 결과', lambda d: d==[], d)
s, d = call('GET', f'/rest/v1/fitting_groups?select=group_id&fitting_id=eq.{rid}', ANON)
t('anon은 그룹 메타데이터 빈 결과', lambda d: d==[], d)
s, d = call('POST', '/rest/v1/rpc/admin_moderate_fitting', tokA, {'p_fitting_id':rid,'p_action':'hide'})
t('비관리자 A의 중재 함수 호출 거부', lambda sd: sd[0] in (400,403,401) or 'forbidden' in str(sd[1]), (s,d))
s, d = call('POST', '/functions/v1/fittings-api', tokA, {'action':'get','id':rid})
t('fittings-api: 봇 미설정 시 제한 피팅 미반환(fail-closed)', lambda sd: sd[0]==404 and sd[1].get('error')=='not_found', (s,d))
s, d = call('POST', '/functions/v1/fittings-api', tokA, {'action':'get','id':pid})
t('fittings-api: 공개 피팅은 재검증 없이 반환', lambda sd: sd[0]==200 and sd[1].get('fitting',{}).get('id')==pid, (s,d))
s, d = call('POST', '/functions/v1/fittings-api', tokB, {'action':'save','id':rid,'ship_slug':'x','name':'x','payload':{},'visibility':'public'})
t('fittings-api: B의 제한 피팅 공개 전환 우회 차단', lambda sd: sd[0]==503 and sd[1].get('error')=='verification_unavailable', (s,d))
s, d = call('POST', '/functions/v1/fittings-api', tokB, {'action':'delete','id':rid})
t('fittings-api: B의 제한 피팅 삭제 차단', lambda sd: sd[0]==503, (s,d))
s, d = call('POST', '/functions/v1/fittings-api', tokB, {'action':'list_mine'})
t('fittings-api: B의 내 목록에 제한 피팅 미노출', lambda sd: sd[1].get('fittings')==[], (s,d))

for st, name, got in R: print(st, name, ('GOT '+str(got)[:140]) if got else '')

call('DELETE', f'/auth/v1/admin/users/{idA}', SVC, apikey=SVC)
call('DELETE', f'/auth/v1/admin/users/{idB}', SVC, apikey=SVC)
call('DELETE', f'/rest/v1/groups?id=eq.{gid}', SVC, apikey=SVC)
s, d = call('GET', '/rest/v1/fittings?select=id', SVC, apikey=SVC)
print('cleanup 후 잔여 피팅:', d)
