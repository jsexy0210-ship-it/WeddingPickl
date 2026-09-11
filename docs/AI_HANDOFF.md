# WeddingPickl AI 인수인계서

> 현재 운영 상태는 `PROJECT_STATUS.md`, 실제 구현은 최신 코드를 기준으로 한다.
> 이 파일은 세션 인수인계와 작업 이력을 보관한다. 과거 기록보다 아래 최신 상태를 우선한다.
> 새 세션이 시작되면 이 파일을 먼저 읽어라. 작업이 끝나면 이 파일을 업데이트하고 커밋해라.

---

## 메타

- `updated_at`: 2026-09-09 (세션·루틴 전면 정리 — 역할 기준 5개 세션 + 루틴 2개)
- `repository`: jsexy0210-ship-it/WeddingPickl
- `verified_code_base`: eff6f59 (#88 squash merge 시점의 main; 최신 원격 상태는 작업 시작 시 재확인)
- `policy_version`: 통합정책 v3.15
- `dashboard`: https://claude.ai/code/artifact/a1307c11-f282-4cf2-a26d-e44bd083d7a9
- `ios_handoff_artifact`: https://claude.ai/code/artifact/b8792fcd-fefe-4386-b24e-41d122e90a87
- `screen_status_artifact`: https://claude.ai/code/artifact/b99277b7-3bdc-45dc-9614-a1310507df53

---

## 배포가 멈춰 있다 — 2026-09-09 05:24 실측

**Render 워크스페이스의 빌드 시간이 소진됐다. 코드 문제가 아니다.**

```
==> Build canceled: your workspace has run out of build pipeline minutes
    for the current billing period.
```

서비스 이벤트 이름이 `pipeline_minutes_exhausted`다. **빌드가 시작조차 못 하고 취소된다.**
2026-09-09에 main에 들어간 커밋이 전부 이 벽에 부딪혔다 — 04:50 · 04:56 · 05:02 · 05:03 · 05:14
다섯 회차 전부 `deploy_ended · failed`. Render 서비스 4개가 모두 「Failed deploy」다(DB는 정상).

### 여기서 배운 것 — 「배포 성공」을 GitHub만 보고 말하지 마라

`main.yml`의 Deploy 잡은 **Render에 배포를 요청하는 데까지만** 초록이다. 그 뒤 Render가
자기 인프라에서 빌드하다 실패해도 GitHub은 초록으로 끝난다. 오늘 여러 세션이 「배포까지
성공」이라고 보고했고 전부 틀렸다. **배포 확인은 `render-deploy-status.yml`을 돌려
`deploy_ended`의 `deployStatus`를 봐야 한다.**

### 풀리기 전까지

머지는 해도 된다(코드는 main에 쌓인다). 다만 **화면에는 아무것도 반영되지 않는다.**
「배포 확인」을 완료로 적지 마라. 사람이 Render 대시보드 → Workspace Settings →
Build Pipeline에서 요금제나 빌드 지출 한도를 올려야 한다.

### 곁가지

`weddingpick-api`(Oregon)가 `render.yaml`에 없는 서비스인데 워크스페이스에 떠 있다.
정리 대상인지 확인이 필요하다 — 쓰지 않는다면 빌드 시간을 갉아먹고 있을 수 있다.

---

## 사용자 결정 — 2026-09-09

새 세션이 이 항목을 다시 파지 않도록 여기 적는다. **아래는 사람이 내린 결정이다.**

| 항목 | 결정 | 따라 나오는 것 |
|---|---|---|
| 지도 보기 | **보류 · 차후 검토** | 지금 지도 화면을 만들지 않는다. `apps/mobile/src/app/(tabs)/wedding/[id]/map.web.tsx`는 그대로 두되 확장하지 않는다. 검색 화면의 목록/지도 토글은 이미 없다(`search/index.tsx:1032`). 안드로이드 위치 권한 두 개(`ACCESS_COARSE_LOCATION` · `ACCESS_FINE_LOCATION`)는 지금 지워도 된다 — 실제로 지도를 넣는 날 다시 선언한다 |
| 카카오 알림톡 | **보류 · 최종 릴리즈 때 추가** | PR #142는 열어둔 채 두고 진행하지 않는다 |
| DB 분리 | **지금은 한 벌 · 차후 분리** | `docs/release-env-split.md`의 0 · 0b · 1단계는 나누는 날 시작 |
| 공공데이터 계정 | **운영계정 하나로 통일** | `SBIZ_API_KEY` 시크릿에는 **운영계정 키**만 넣는다. 개발계정 키는 하루 1,000건이고 오퍼레이션마다 승인 범위가 달라 같은 코드가 어떤 날은 되고 어떤 날은 403이다. 포털 활용신청을 운영계정으로 올려 승인받은 뒤 시크릿을 교체한다. 코드는 `collect.ts`의 `assertServiceOk`가 resultCode를 읽어 무엇을 해야 하는지 말해준다 |
| 카카오 동의항목 · 만 14세 | **로그인 화면 체크박스로 되돌렸다**(2026-09-09 사용자 오더 「14세 로그인 바꾸기 이전으로 싹다 롤백」) | `fd111f0` 직전 상태다 — 로그인 화면의 「만 14세 이상이에요」 체크박스로 자기 신고를 받고, 서버는 그 값을 믿는다. 카카오 출생 연도 판정 · 경계 나이 차단 · 수집 항목 안내 블록은 **전부 되돌렸다**. 되돌린 범위는 로그인 · 나이 · 카카오 동의항목 파일뿐이다(사용자가 범위를 그렇게 정했다) — 탈퇴 화면 문구와 온보딩 완료 문구는 그대로 두었다. **주의**: 카카오 콘솔에는 「필수 출생 연도 · 프로필」로 신청한 이력이 남아 있어 코드와 콘솔이 어긋난다. 다시 신청하기 전에 어느 쪽에 맞출지 사용자에게 확인한다 |
| 후기 표기 | **별점 · 무조건 5.0 만점 환산** | **`SPEC.md` §6.1 「별점을 쓰지 않습니다 · 평점 숫자를 만들지 않습니다」와 용어집의 「별점 → 이용한 사람들의 경험」은 이 결정으로 무효다**(2026-09-09). 명세보다 사용자 결정이 앞선다. **되돌리지 마라** — 시안만 보고 3축 3지선다로 «고치면» 결정을 뒤집는 것이다. 평균은 서버가 이미 준다(`usageScore.average` 1~5). 그리는 곳: 업체 상세 ⑧ · 후기 목록 행. 컴포넌트는 `packages/ui/src/rating-stars.tsx` |
| 관리자 화면 | **`/admin` 하나로 통일** | 관리자가 둘이었다. `weddingpick-app-web.onrender.com/admin`(expo 콘솔 27화면)만 남기고 `admin.html`·`weddingpick-admin` 서비스·`admin.weddingpick.kr`을 지웠다(2026-09-09 사용자 결정). **`admin.html`에만 있던 화면 넷은 사라졌다** — 개인정보 검토(`pii-reviews`) · 이의제기(`objections`) · 결정 브리핑·열린 결정(`decisions/*`). **넷 다 `/admin`에 새로 만들어 넣었다** — 개인정보 검토 · 후기 이의제기 · 자동 결정 현황(브리핑+열린 결정 한 화면). 없어진 기능은 없다. **2026-09-10에 이 통일 결정을 되돌렸다** — 관리자 콘솔을 다시 별도 출처(`weddingpick-admin.onrender.com/admin/*`)로 분리했다. 화면 코드는 그대로 두고 배포만 갈랐다. 얻는 것은 출처 분리 하나이고 IP 차단은 얻지 못한다 — 범위와 전환 절차는 `docs/admin-origin-split.md` |
| 커스텀 도메인 | **폐기했다**(2026-09-11 대표 지시) | `weddingpick.kr` · `admin.weddingpick.kr` · `www.weddingpick.kr` **셋 다 이름 풀이가 안 된다**(2026-09-09 실측, `NXDOMAIN`). `main.yml`의 「Custom domains」 스텝은 Render 쪽에 **등록만** 하고, 실제 레코드는 등록처(가비아)에 사람이 넣어야 한다. 그래서 워크플로가 초록이어도 도메인은 죽어 있다. onrender 주소는 정상. **이 주소로 재현한 장애 보고는 전부 무효다** — 열린 적이 없다 |
| 광고 실운영 | **오더 대기** | 스토어 등록정보의 「광고 포함」은 «없음» |
| 국외 이전 | **고지하고 쓴다 · 인프라를 국내로 옮기지 않는다**(2026-09-09 사용자 결정) | 서비스는 국내용이지만 인프라는 대부분 미국이다 — API·앱웹·웹사이트 Render(미국), DB Neon(**싱가포르** — 회사는 미국 사업자지만 서버 리전은 AWS 싱가포르다, `docs/INFRA_ACCESS_AUDIT_2026-09-10.md`), 문서 읽기 Anthropic(미국), 푸시 중계 Expo(미국). 국내는 원본 이미지 저장소 NCP 하나뿐이다. **국외 이전 자체가 위법이 아니라 고지 없이 이전하는 것이 위법이다**(개인정보보호법 제28조의8). 처리방침 4항(처리위탁)·5항(국외 이전)에 이전받는 자·국가·항목·시기·방법·보유기간·거부 방법을 적었다. **되묻지 마라** — 「국내 서비스인데 왜 국외 이전이냐」는 사용자가 이미 물었고 답을 듣고 1번(고지)을 골랐다. 옮기는 쪽은 사용자 오더가 있을 때만 시작한다. **2026-09-11 대표 승인(승인 B)으로 API를 싱가포르로 옮긴다 — 절차는 `docs/render-region-move.md`, 고지(처리방침 개정)가 이전보다 먼저다** |
| 릴리즈 프로덕션 빌드 | **보류 — 사용자가 「완료」라고 말할 때만 올린다**(2026-09-09) | `eas build --profile production` · `eas submit` · Play Console 업로드를 **누구도 먼저 하지 않는다.** 최종 검수는 사용자가 한다. 준비물(서비스 계정 JSON · 스크린샷 · 그래픽 이미지)은 갖춰 두되 올리지 않는다 |
| 카카오 동의항목 콘솔 | **코드는 롤백됐고 콘솔 신청 이력은 남아 있다**(2026-09-09) | 1차 신청은 **필수** 출생 연도 · 프로필(닉네임·사진), 나머지 「사용 안 함」이었고 **반려**됐다(회원가입 절차 불명확 · 수집 항목 미기재 · 탈퇴 경로 누락). 그 대응으로 넣었던 코드는 사용자 오더로 롤백했다 — 지금 `scopes`와 `/v2/user/me`는 `fd111f0` 직전 값이다. 다시 심사에 넣으려면 코드와 콘솔을 어느 쪽으로 맞출지부터 정해야 한다 |

---

## 저장소 정리 — 2026-09-07

`main`을 유일한 기준으로 만들기 위해 브랜치·PR·문서·워크플로를 전수 점검했다.
**Git history는 건드리지 않았다** — history rewrite·force push·PR 이력 삭제 없음.

- 정리 기준 main: `eff6f59` (#88 squash merge)
- Open PR: #88·#100 병합, #99 종료(임시 조사 스냅샷 — 실질 내용은 아래 결함 목록으로
  옮겼다). **#101(`claude/stabilize-p0`)은 다른 세션이 지금 작업 중이라 그대로 둔다** —
  `/health`의 스키마 상태 보고와 안정화 기록이다
- Remote branch 70개 중 **60개를 삭제 대상으로 판정**했다. 다만 이 세션의 git 프록시가
  ref 삭제 push를 403으로 막아 **실제 삭제는 아직 안 됐다** — 아래 «삭제 대기 브랜치» 절의
  명령을 사람이 한 번 돌려야 한다
- 남길 브랜치: `main`, `claude/stabilize-p0`(PR #101 진행 중), 아래 «보류 브랜치» 7개
- 삭제한 파일: `WeddingPickl`(.gitmodules 없는 깨진 서브모듈 링크),
  `pnpm-lock.yaml`(npm 저장소인데 남아 있던 중복 락파일), `color-test.html`
  (참조 0건, 폐기된 v7 시안 비교용 스크래치)
- `public-data.yml`: 삭제된 작업 브랜치를 보던 죽은 push 트리거 제거
- 워크플로 10개는 전부 목적이 갈린다(로컬 gradle APK / EAS preview APK / EAS init /
  릴리즈 / CI·배포 / 운영·스테이징 마이그레이션 / 스토리지 점검 / env sync /
  공공데이터). **삭제·통합 대상 없음**
- 문서는 `docs/README.md`가 이미 색인·폐기 기준을 관리하고 있고, `archive/`의 과거
  정책서는 코드 주석이 절 번호로 참조한다(`packages/domain/*`·`api-contract/*`).
  **문서 삭제는 하지 않았다** — 지우면 그 참조가 끊긴다

### 삭제 대기 브랜치 (60개)

판정 근거는 셋 중 하나다 — **PR이 병합돼 내용이 main에 있다**(48개), **tip이 main의
조상이거나 main과 diff가 없다**(3개), **내용이 이미 main에 반영됐거나 폐기됐음을 diff로
확인했다**(9개: 마이그레이션 재번호 `0061`·`0062`는 #40/#41로 이미 적용, `flyio-new-files`는
Render를 쓰는 지금 쓰이지 않는 `fly.toml`, `design/*` 4개는 `design/search-vendor-clean`이
포함, 조사 스냅샷 브랜치 2개, `fix/render-sync-inputs-context`는 작성자가 진단 철회).

지운 브랜치는 GitHub의 해당 PR 화면에서 되살릴 수 있다. tip SHA는 이 커밋 시점의
Git history에 남아 있다.

```bash
for b in \
  claude/audit-review-2026-09-07 \
  claude/backend-gaps-olvj3m \
  claude/daily-progress-briefing-3k7lez \
  claude/fe-design-pixel-match \
  claude/fe-screens-admin-p0 \
  claude/fe-screens-common-states \
  claude/fe-screens-cpl-biz-sht-2nd \
  claude/fe-screens-expo \
  claude/fe-screens-our-my-home \
  claude/fix-db-migration-0061 \
  claude/fix-db-migration-0062 \
  claude/fix-migration-numbering-collision-260902 \
  claude/home-c1 \
  claude/information-gathering-sy6e01 \
  claude/lifecycle-policy-scope \
  claude/payment-proof-count-fix \
  claude/render-migration \
  claude/session-a4bq31 \
  claude/web-front-office \
  claude/wedding-events-map-view-260902 \
  claude/wedding-pick-android-apk-tjo2gg \
  claude/weddingpick-master-bootstrap-6j1c7o \
  claude/withdrawal-copy-alignment-15037 \
  codex/github-audit-handoff-20260907 \
  codex/social-login-completion \
  codex/sync-kakao-p0-handoff \
  codex/web-open-graph \
  codex/wedding-public-data-pipeline \
  design/home-screen \
  design/pick-screen \
  design/search-vendor \
  design/wedding-my \
  docs/consolidate-policy-main \
  docs/hybrid-web-policy \
  docs/hybrid-web-qa-checklist \
  docs/session-handoff-staging-green \
  feat/auth-v3.11 \
  feat/email-login \
  feat/landing-fixed-vendors \
  feat/render-env-automation \
  fix/canonical-pick-mark \
  fix/kakao-authorization-code-flow \
  fix/lint-set-state-in-effect \
  fix/monthly-draw-migration-collision \
  fix/oauth-web-redirect \
  fix/public-data-workflow-secrets-if \
  fix/render-blueprint-sync-nonblocking \
  fix/render-sync-inputs-context \
  fix/stale-policy-status-tests \
  fix/vendor-category-and-login-visuals \
  fix/web-autofill-input \
  flyio-new-files \
  home/fe-p0-gaps \
  hybrid/guest-removal \
  hybrid/qa-home-entry-shared \
  hybrid/qa-my-events \
  hybrid/qa-pick \
  hybrid/qa-search-vendor \
  hybrid/shell-poc \
  hybrid/wedding-followups
do
  git push origin --delete "$b"
done
```

### 보류 브랜치 (삭제하지 않음)

Closed PR이지만 main에 없는 고유 코드가 남아 있다. 되살릴지 버릴지는 사람이 정한다.
(`claude/stabilize-p0`은 여기 해당하지 않는다 — 진행 중인 PR #101의 브랜치다.)

| 브랜치 | 무엇이 main에 없나 |
|---|---|
| `claude/backend-gaps-9xrh1d` (#26) | 관리자 API 13종·네이버 로그인 서버 구현 일부 |
| `claude/front-dev-start-nrr0jh` (PR 없음) | `routes/wedding-timeline.ts`·`guide-articles.ts` |
| `claude/frontend-development-i1j2aa` (#16) | `my/preferences.tsx`(WP-MY-004 취향 다시 고르기) |
| `design/search-vendor-clean` (#70) | 디자인 핸드오프 싱크 정리본 — 나머지 `design/*` 4개는 이 브랜치가 포함하므로 삭제함 |
| `feat/login-other-page` (#85) | `other-login-sheet.tsx` — 단, v3.12에서 소셜 4종이 카카오+이메일로 축소돼 유효성 재확인 필요 |
| `home/fe-expo-screens` (PR 없음) | WP-EXPO 화면 5종 보완 |
| `copilot/analyze-code-and-identify-issues` (PR 없음) | 배포 환경별 secret 분리(G05 대응안). Secrets 등록이 선행돼야 해 임의 반영하지 않음 |

**HANDOFF 중복 주의:** PR #101이 저장소 루트에 `HANDOFF.md`를 새로 만든다. 병합되면
이 파일(`docs/AI_HANDOFF.md`)과 둘이 된다 — 어느 쪽이 정본인지 그 시점에 정하고
한쪽으로 합쳐야 한다.

`fix/render-sync-inputs-context`(#97)는 삭제했다 — 작성자가 진단을 철회했다.
`${{ inputs.* }}`는 `workflow_dispatch` 밖에서 빈 값이 될 뿐 오류가 아니고, 실제
원인은 계정 차원의 Actions 중단이었다(저장소 공개 전환으로 해소).

---

## 🔴 미해결 결함 (2026-09-07 감사 · 2026-09-09 갱신)

PR #99의 조사 보고서와 그 독립 재검증 결과에서 **코드로 확인된** 항목만 남긴 것이다.
오탐으로 판정된 항목은 없었다. 원문은 Git history(브랜치 `codex/github-audit-handoff-20260907`,
`claude/audit-review-2026-09-07`의 커밋)에서 볼 수 있다.

2026-09-09에 해소된 것은 아래 «해소» 절로 옮겼다. N01과 G05는 같은 날 실측으로
근거가 바뀌어 본문을 고쳤다 — 옛 근거를 그대로 두면 다음 사람이 이미 죽은 가설을
쫓는다.

### 출시 차단

| # | 항목 | 위치 · 근거 |
|---|---|---|
| N01 | **운영 카카오 로그인이 500으로 실패** | `POST /v1/auth/sessions → 500`. **스키마 가설은 2026-09-09 죽었다**(아래 DB-1). 같은 날 코드로 범위를 좁혔다 — 아래 «N01 좁힌 범위». 남은 것은 **검증 성공 이후의 DB 경로 세 곳**뿐이고, 다음 한 걸음은 재현 시 Render 로그의 스택·SQL 원문이다 |
| G04 | **CORS 출처 누락** (메서드는 해소) | `infra/render-env.yml`의 `CORS_ORIGINS`에 admin 출처·커스텀 도메인이 없다. 도메인은 이미 활성이라 미래 위험이 아니라 현재 차단. **`server.ts`의 `methods`에 PATCH가 없던 절반은 #134로 해소됐다** |
| G02 | **main 보호 규칙에 필수 PR·CI·리뷰 없음** | `rules/branches/main`이 `deletion`·`non_fast_forward` 2개만 반환. 실패한 변경의 병합을 막는 장치가 없다 |

### 높음

| # | 항목 | 위치 · 근거 |
|---|---|---|
| 잔존-A′ | kill switch 6종(AI 3 · 통계 · 보상 · 자동게시)이 여전히 인메모리다 | `routes/admin.ts`의 `killSwitches` Map은 그대로다 — 껐다고 표시돼도 기능은 돌고 재시작하면 상태가 사라진다. **수집 출처 스위치만 #134로 DB(`import_switches`)에 연결됐다.** 나머지 6종은 각각 읽는 쪽을 만들어야 한다 |
| G05 | staging 이름의 job이 운영 대상을 검사 | `main.yml`의 Staging·Production 두 job이 같은 `DATABASE_URL`과 같은 health URL(`weddingpickl.onrender.com`)을 쓴다. `db-migrate-staging.yml`만 `STAGING_DATABASE_URL`을 쓴다. **처리 방침은 `docs/release-env-split.md`가 정본이다** — 사용자 결정(2026-09-09) 「우선 현재 DB 그대로, 차후에 분리」로 §3의 0·0b·1·2는 나누는 날로 미뤄졌다. `PRODUCTION_DATABASE_URL`에 Render 내부망 주소가 들어 있어(`getaddrinfo EAI_AGAIN`) 이름부터 옮기면 어떤 워크플로도 운영 DB에 닿지 못한다 |
| DB-2 | 스테이징 DB가 19개 밀려 있다 | 적용 73 / 기대 92(0074~0091a 미적용, 2026-09-09 실측). 「스테이징에서 먼저 검수한다」가 지금 성립하지 않는다. `db-migrate-staging.yml` 실행은 사용자 승인 대기. **N01 재현용으로서의 값은 없다** — 스키마 가설이 죽어 그 실험이 가르는 것이 없다 |

### 출시 전 처리

| # | 항목 |
|---|---|
| G10 | 마케팅 preview artifact가 업로드되지 않는다 — CLI는 `apps/api/.marketing-preview`에 쓰는데 `main.yml`은 루트를 본다. `.`으로 시작해 `include-hidden-files: true`도 필요 |
| ~~G13~~ | **2026-09-09 PR #136에서 해소 — 실제 위반 지점은 `home-page.ts` · `vendor-page.ts`였다.** 원문 근거(`landing-v4.ts`에 시연 표기 0건)는 사실이 아니다: 그 파일은 2줄짜리 re-export 껍데기고 랜딩 카피는 전부 `spec/strings.ko.json`에서 오며 구체 금액이 한 건도 없다 — **다시 열어보지 않아도 된다.** 진짜 위반은 두 웹 화면이 `guidePrice`를 읽지 않고 금액을 직접 그린 것이었다(v3.24 «금액 한 줄은 어느 화면이든 `priceLine`으로만»). 그 탓에 실 제보 3건 미만 업체는 업체 안내 금액이 있어도 「아직 정보가 적어요」로만 나왔고, 출시 첫날 실 제보 0건이면 웹 전체가 빈 화면이 된다 |
| G12 | 마케팅 대시보드가 DB 오류를 «0건 성공»으로 숨긴다 — `routes/admin.ts`의 catch에 `NODE_ENV` 검사가 없다 |
| G11 | 소재를 수정해도 `reviewed`·`reviewed_at`이 갱신되지 않아 과거 승인 상태가 남는다 (`marketing/store.ts`) |
| 잔존-C | AI 호출 한도가 원자적이지 않다 — `callsToday()`의 SELECT와 `recordUsage()`의 INSERT가 별도 트랜잭션 (`analysis/pipeline.ts`) |
| 잔존-D | 죽은 워커의 `running` 작업을 회수하는 reaper가 없다 (`analysis/worker.ts`의 `claim()`이 `pending`만 집는다) |
| 잔존-E | `routes/documents.ts`의 `MAX_FILE_SIZE`가 죽은 상수다. S3 드라이버는 presigned POST 정책이 강제하므로 실질 노출은 local 드라이버 한정 |
| 잔존-F | `packages/db/src/reset.ts`의 `DROP SCHEMA ... CASCADE`에 테스트 DB 가드가 없다 |
| sbiz | 운영계정 승인 완료(2026-09-08, 활용기간 2028-09-08까지). 업종코드는 `collect.ts`에서 제거해 설정값(`SBIZ_UPJONG_CODES`)으로 옮겼다 — 코드가 비면 수집이 즉시 실패한다. `SBIZ_API_KEY` 등록 후 `public-data.yml`의 `lookup_level`로 실제 코드를 찾아 저장소 Variables에 넣어야 `sbiz-seoul`·`sbiz-gyeonggi`가 동작한다 |

### DB-1 — 운영에만 있는 마이그레이션 3개: 확인 끝났다. 스키마는 정상이다

**다시 파지 마라.** 2026-09-09 `db-status.yml` target=default(실행 34309171711)로 이름까지 확인했다.

```
적용 96 / 기대 93 · 밀린 것 없음
저장소에 없는 것: 0052_mission_draw · 0059_wedding_events · 0060_vendor_geo
```

셋 다 **번호를 다시 매긴 흔적**이고 사고가 아니다. 저장소에서 대조했다.

| 운영 DB에 적힌 것 | 지금 저장소 | 무엇이 달라졌나 |
|---|---|---|
| `0052_mission_draw` | `0053_reward_kind_monthly_draw`가 이어받음 | `ALTER TYPE ... ADD VALUE`로 더한 값은 같은 트랜잭션에서 쓸 수 없어 다음 마이그레이션으로 미뤘다(파일 첫 줄에 그 이유가 있다) |
| `0059_wedding_events` | `0061_wedding_events` | `CREATE TABLE`·`CREATE INDEX` → `IF NOT EXISTS` |
| `0060_vendor_geo` | `0062_vendor_geo` | `ADD COLUMN` → `IF NOT EXISTS`, 제약은 `DO $$ ... EXCEPTION WHEN duplicate_object THEN NULL` |

즉 **이미 옛 번호로 적용된 DB 위에 새 번호가 다시 돌아도 안전하도록** 멱등 가드를 넣은 것이다. 재적용은 무해한 no-op이었고 그래서 「밀린 것 없음」이다.

**그래서 운영 스키마는 저장소가 기대하는 모양과 같다.** 다음 셋이 모두 성립하지 않는다.

- 「`structured.users`에 기본값 없는 NOT NULL이 붙었다」 — 셋 중 users에 컬럼을 더하는 것이 없다. `0061`이 users를 보는 곳은 `added_by uuid REFERENCES structured.users (id)` 외래키 한 줄뿐이다(37행).
- 「`identity.identities`에 모르는 제약이 붙었다」 — 셋 중 identities를 건드리는 것이 없다.
- 「같은 번호로 내용만 바뀌어 옛 정의가 남았다」 — 번호가 **다르게** 바뀌었고 방향은 「더 안전하게」였다.

`schema_migrations`의 그 세 행은 **지우지 않는다.** 지울 이유가 없고, 지우면 이 기록 자체가 사라진다.

### N01 좁힌 범위 (2026-09-09 · 코드)

500이 날 수 있는 자리를 `routes/auth.ts`의 `POST /v1/auth/sessions`에서 하나씩 지웠다.

- **카카오 검증 실패가 아니다.** `try/catch`가 `provider.verify()`만 감싸고 잡은 것을 전부 `ApiError('unauthenticated')`로 바꾼다(`routes/auth.ts:66~71`). `errors.ts`가 그것을 401로 매핑한다. 토큰 교환 실패·`id_token` 없음·JWKS 검증 실패는 **어느 것도 500이 될 수 없다.**
  - 그래서 `KAKAO_CLIENT_SECRET` · 리다이렉트 URI · 앱 키가 어긋난 경우도 배제된다. 그건 `identity-provider.ts:247`이 던지고 **401로 나온다.**
  - 동의항목(scope)도 배제된다. 두 겹이다 — `apps/mobile/src/features/auth/providers.ts:171`이 이미 `scopes: ['openid', 'profile_nickname']`이고, 설령 `openid`가 빠져도 「카카오 id_token이 없다」 throw(`identity-provider.ts:251`)는 같은 `try/catch` 안이라 401이 된다.
- **요청 형식 문제가 아니다.** `createSessionRequestSchema.parse`의 `ZodError`는 `server.ts:74`가 400으로 바꾼다.
- **Fastify가 붙인 4xx도 아니다.** `server.ts:91~94`가 그대로 통과시킨다.

남은 것은 `try/catch` **바깥**, 즉 검증이 성공한 뒤의 DB 경로 셋뿐이다.

| 자리 | 무엇을 하는가 |
|---|---|
| `signIn()` (`auth/sessions.ts:26~113`) | identities 조회·갱신 또는 users INSERT + identities INSERT, `display_name` 갱신, `is_operator` 조회, sessions INSERT — 한 트랜잭션 |
| `markAgeVerified()` (같은 파일 166행) | `age_verified` · `age_gate` 갱신. `age_verdict === 'verified'`일 때만 |
| `sessionEntry()` (같은 파일 135행) | `activated_at` · `weddings` 존재 여부 · `age_verified` 조회 |

스키마가 정상인데 이 셋이 터진다면 데이터에 딸린 것이다(제약 위반·유일키 충돌 등). **다음 한 걸음은 재현 시 Render 로그의 스택·SQL 원문 하나다** — #100으로 로그는 살아 있다. 그것이 오면 위 셋 중 어디인지 즉시 갈린다.

한 가지 더 확인할 것: **500이 정말 500인지.** 브라우저에서 시작하는 흐름이면 CORS preflight 차단(G04)이 500처럼 보일 수 있다. 응답 본문과 상태 코드를 함께 봐야 한다.

### 해소 (2026-09-09)

| # | 무엇이었나 | 어떻게 해소됐나 |
|---|---|---|
| 잔존-A(수집분) | 수집 출처를 화면에서 끌 수단이 0건이었다 | #134 — `GET/PATCH /v1/admin/kill-switches`가 `structured.import_switches`를 읽고 쓴다(`import:<source_key>` · 카테고리 `수집`). 나머지 6종은 위 잔존-A′로 남았다 |
| 잔존-B | 관리자 클라이언트가 204에 `res.json()`을 불러 성공한 PATCH가 실패로 잡혔다 | #134 — `apps/mobile/src/app/admin/_api.ts`가 204에 `null`을 돌려준다 |
| G04(메서드분) | CORS `methods`에 PATCH가 없어 관리자 화면의 PATCH가 preflight에서 전부 막혔다 | #134 — `server.ts`에 `PATCH` 추가. 출처 누락은 위 G04로 남았다 |
| 시드 워크플로 | `db-seed-samples.yml`이 「스테이징」이라 적고 운영 시크릿을 썼다. `remove`는 업체·이미지·결제인증·계정을 지운다 | #134 — 대상 선택(기본 staging)으로 바꿨다. 운영 전용 고정은 DB를 나누는 날로 미뤄졌다 |
| 수집 크론 | `public-data.yml`의 `--apply`가 토요일 크론으로 **사람 없이 운영 DB에 썼다** | DATA 세션 소관(PR #133 계열)으로 넘겼다 — 이 목록에서는 그쪽 진행을 따른다 |

### 외부 확인 필요 (저장소 안에서 확인 불가)

- **카카오 로그인 재현 시 Render 로그의 스택·SQL 오류 원문** — N01의 다음 한 걸음. 위 «N01 좁힌 범위»의 셋 중 어디인지 즉시 갈린다
- 그때의 **응답 상태 코드와 본문** — 500이 진짜 500인지, CORS preflight 차단(G04)이 그렇게 보이는 것인지
- 운영 Render `WeddingPickl`의 `DATABASE_URL`이 GitHub `DATABASE_URL`과 같은 DB인가
- 분석 워커 서비스가 Render에 실제로 있는가 (저장소에 선언 없음)
- TestFlight / Play 제출·심사 상태
- legacy branch protection API(`branches/main/protection`) 설정

### 권장 순서

1. N01 — 재현 시 Render 로그의 스택·SQL 원문을 잡는다 → «N01 좁힌 범위»의 셋 중 하나로 확정 → 수정.
   스키마 갈래는 닫혔다(DB-1)
2. G04 — `CORS_ORIGINS`에 admin 출처·커스텀 도메인 추가. 각 출처에서 preflight 통과 확인
3. G02 — main 보호 규칙에 필수 PR + head CI 성공
4. 잔존-A′ — kill switch 6종을 읽는 쪽 만들기. 수집 스위치(#134)와 같은 방식으로 DB에 둔다
5. DB-2 — 사용자 승인 후 스테이징을 92까지. 그래야 「스테이징에서 먼저」가 성립한다(N01 재현용은 아니다)
6. G05 — `docs/release-env-split.md` §3의 0 → 0b → 1 → 2 순서. 0은 사용자만 할 수 있다
7. 나머지 항목에 각각 단위 테스트를 붙이며 정리

---

## 🔴 2026-09-04 정책 변경 — 하이브리드 웹뷰 전환

### 배경
사용자가 2026-09-04에 확정: 홈·진입/내비게이션·공통(FAQ·약관·시트·상태) 화면군을
시작으로 RN 네이티브 화면을 점진적으로 **하이브리드 웹뷰**로 전환한다.

### 기술 방식
- `apps/mobile`의 기존 Expo Router/React Native 코드베이스는 그대로 유지한다 — 화면을
  새로 만들지 않는다.
- 이 코드베이스를 `expo export -p web`(react-native-web)으로 웹 빌드해 호스팅한다.
- 네이티브 iOS/Android 앱은 그 호스팅 URL을 `react-native-webview`로 감싸는 얇은 셸이
  된다. **`react-native-webview`는 아직 `apps/mobile`에 설치돼 있지 않다** — 전환
  작업의 일부로 추가해야 한다.
- `apps/web`(정적 랜딩 1장, `tsx src/cli.ts` 빌드)과는 완전히 별개다 — 이 전환과
  무관하며 건드리지 않는다.
- 이 방식을 고른 이유: `apps/mobile`이 이미 Expo 웹 빌드를 지원하므로(네이티브 전용
  의존성은 `Platform.OS === 'web'` 조건부 처리, 위 "일정·지도 보기" 세션 기록 참고)
  별도 웹앱을 새로 만들 필요가 없다 — 가장 적은 신규 인프라로 시작할 수 있는 경로다.

### 이번 전환의 실질적 의미
RN 화면의 웹 렌더링 품질이 이제 "부가 기능"이 아니라 **실제 앱 화면 그 자체**가 된다.
`apps/mobile/src/app/` 아래 화면 소스가 모바일 폭부터 데스크톱 폭까지 브라우저에서
정상 렌더링돼야 실제 앱이 정상 동작하는 것이다. 점검 기준:
`docs/design-handoff/hybrid-web-qa-checklist.md`.

### 정책 1 — 비회원 진입 삭제
로그인 없이 들어갈 수 있는 화면(게스트 홈 등)을 폐지한다. 로그인 완료 후에만 앱 진입이
가능하도록 진입 흐름을 바꾼다.
**구현 완료** — `apps/mobile/src/app/_layout.tsx:188` 「비회원 진입 삭제 — 로그인이
안 된 사람은 무조건 로그인 화면으로」 뒤 `setEntry('login')`. 같은 파일 33번째 줄에
정책 근거 주석이 있다.

### 정책 2 — 홈 헤더 검색버튼 삭제
홈 탭 헤더의 검색 버튼을 없애고 알림 아이콘만 남긴다. 검색 자체는 하단 탭의
검색 탭(`(tabs)/search`)으로 계속 접근 가능하니 기능 손실은 아니다.
**구현 완료** — `apps/mobile/src/app/(tabs)/index.tsx`에 `router.push('/search')`가
0건이다. 헤더는 177번째 줄 `<Header unread={…} onPressBell={…} />` 하나만 남았다.

### 다음 작업

완료 — 근거는 코드로 확인했다(2026-09-09 · FE).

1. `react-native-webview` 설치 + 네이티브 래퍼 셸 — `apps/mobile/package.json:41`에
   `react-native-webview@14.0.1`, 셸은 `apps/mobile/src/features/webshell/WebShellView.tsx`.
2. 정책 1·2 실제 코드 반영 — 바로 위 두 절의 근거 줄.
3. v3.22 · v3.24 금지어 정리 — `확인된 제보` · `확인된 정보` · `오늘의 Pick` ·
   `우리 준비` · `네이버페이 포인트`가 `apps/` · `packages/` · `spec/`에 0건이다.
   금지어 목록 자체인 `spec/glossary.json`의 `term` 항목만 남아 있고 이것이 정상이다.

미착수 — 선행조건이 있다.

4. 웹 빌드 호스팅 방식 결정(`expo export -p web` 결과물을 어디에 올릴지).
   스테이징 서버 분리가 먼저다 — 순서는 `docs/release-env-split.md`.
5. `docs/design-handoff/hybrid-web-qa-checklist.md` 기준으로 홈·진입/내비게이션·공통
   화면군부터 웹 렌더링 QA. 4번이 끝나야 돌릴 수 있다.

---

## 인프라 현황

### 최신 P0 상태 (2026-09-03)

운영 기록은 `PROJECT_STATUS.md`와 동기화했다. 이번 작업에서 외부 콘솔·운영 DB·실기기를 재검증한 것은 아니다.

| 항목 | 상태와 남은 검증 |
|---|---|
| 로그인 설정 | APK의 callback·Client ID 반영 기록 있음. 네이버·카카오·Google·Apple 외부 등록과 실제 로그인 검증 필요 |
| 카카오맵 | 외부 카카오맵 열기가 채택된 방식. 업체 검색·상세에 링크 구현. 우리웨딩 지도와 웹 경로는 아래 6번의 잔여 작업 참고 |
| 운영 서버·DB | 2026-09-03 `/health` HTTP 200, `database: ok` 기록 있음. 전체 기능·마이그레이션 적용 완료를 뜻하지 않음 |
| 운영 마이그레이션 | 0052~0062 적용 여부 확인 필요. PR #53의 0003 → 0068 이동은 main 반영됨. 운영 적용 결과·기존 DB 이력 확인 필요 |
| iOS | Release #13의 Sign in with Apple 프로비저닝 권한 누락 기록. 수정 후 Production Build·TestFlight 확인 필요 |
| Android 제출 | Google Play 계정 본인확인 이의 제기 결과 대기 기록. 해제 후 제출 검증 |
| 기능 검증 | PR #53 머지 전 로컬(0912715 + 기존 작업 변경)에서 946개 통과, 별도 테스트 DB 미연결로 619개 스킵. 최신 main·실기기·운영 환경 전체 흐름은 미검증 |

P0 전체 항목의 완료 기준과 검증 증거가 확정되지 않아 P0 진척률은 미측정이다. `npm run progress`는 문서 표시 기반 전체 공정률이며 P0 출시 준비율이 아니다.

### 서버 · 외부 서비스 (2026-09-08 소유자 확인 — 이 목록이 전부다)

| 구분 | 서비스 | 비고 |
|---|---|---|
| API | Render `weddingpickl` — `https://weddingpickl.onrender.com` | Node/Fastify, Docker. 환경변수 원본은 `infra/render-env.yml` |
| 앱 웹 export | Render `weddingpick-app-web` — `https://weddingpick-app-web.onrender.com` | `apps/mobile` react-native-web 정적 빌드 |
| 서비스 웹사이트 | Render `weddingpick-web` — `https://weddingpick-web.onrender.com` | `apps/web` 정적 빌드 |
| 관리자 | Render `weddingpick-admin` — `https://weddingpick-admin.onrender.com/admin/*` | `apps/mobile` 같은 export를 `scripts/split-admin-dist.mjs admin`으로 깎은 것. `admin.html`은 2026-09-09에 없어졌다 |
| DB | Neon PostgreSQL | `DATABASE_URL` |
| 원본 문서 저장소 | NCP Object Storage (S3 호환) — 버킷 `weddingpick-test` | `STORAGE_DRIVER=s3` + `S3_BUCKET` · `S3_REGION` · `S3_ENDPOINT` · `AWS_ACCESS_KEY_ID` · `AWS_SECRET_ACCESS_KEY` |
| 모바일 빌드·배포 | Expo EAS · Apple Developer · Google Play Console | `release.yml` · `eas-*.yml` · `android-apk.yml` |
| 도메인 | 없다 — `weddingpick.kr`은 폐기했다(2026-09-11 대표 지시) | |
| 로그인 | Kakao Developers | `KAKAO_APP_KEY` · `KAKAO_CLIENT_SECRET`. 애플·구글·네이버는 기존 계정 검증용 코드만 남아 있고 새 로그인 버튼은 없다 |
| 문서 분석(Pick 인증) | Anthropic API | `ANTHROPIC_API_KEY` — `apps/api/src/analysis/*`가 읽는다 |
| 공공데이터 수집 | 소상공인진흥공단 API(무료) | `SBIZ_API_KEY`, `public-data.yml` |
| CI/CD | GitHub Actions | 아래 표 |

**사용하지 않음(삭제됨, 2026-09-08)**: Resend(비밀번호 재설정 메일 — 이메일 로그인과 함께 삭제), Fly.io(Render로 대체), Backblaze B2(NCP Object Storage로 대체).

### GitHub Actions 워크플로
| 파일 | 역할 |
|---|---|
| `main.yml` | PR CI; main push 시 CI → DB 마이그레이션 → Render 배포·헬스체크 |
| `keep-warm.yml` | Render 무료 플랜 API가 잠들지 않게 주기적으로 `/health` 호출 |
| `db-migrate.yml` | Neon 운영 DB 마이그레이션 적용 |
| `db-migrate-staging.yml` | 스테이징 DB(`STAGING_DATABASE_URL`) 마이그레이션 적용 |
| `db-status.yml` | DB 마이그레이션 적용 상태 조회 |
| `db-seed-samples.yml` | 샘플 업체·이미지 시드 |
| `db-delete-test-user.yml` | 테스트 계정 삭제(`apps/api/src/scripts/delete-test-user.ts`) |
| `render-env-sync.yml` | `infra/render-env.yml`을 Render 서비스 환경변수로 upsert |
| `render-trigger-deploy.yml` | Render 배포 수동 트리거 |
| `render-deploy-status.yml` | Render 배포 상태 조회 |
| `storage-test.yml` | NCP Object Storage(S3 호환) 업로드·다운로드·삭제 연결 테스트 |
| `public-data.yml` | 공공데이터(소상공인진흥공단) 수집 |
| `android-apk.yml` | Android APK 빌드 |
| `eas-init.yml` · `eas-apk-preview.yml` | EAS 프로젝트 초기화 · preview APK |
| `release.yml` | iOS EAS 빌드 배포 |

---

## 하이브리드 웹뷰 쉘 POC (2026-09-04, `hybrid/shell-poc` 브랜치, PR 별도)

`apps/mobile`의 웹 export(react-native-web, `npm run export:web`, CI `main.yml`의
`Bundle (web)` 스텝에서 이미 매번 빌드 검증됨)를 실제로 호스팅해서, 네이티브 쉘이
자기 자신의 웹 빌드를 웹뷰로 띄우는 구조를 검증한 POC다.

**인프라(2026-09-08 정리)**: 운영 인프라는 **Render**다(API: `weddingpickl.onrender.com`).
이전 Fly.io 설정·문서는 저장소에서 모두 지웠다 — §인프라 현황의 서버 표가 현재 기준이다.

### 1. 웹 번들 호스팅 — Render 정적 사이트, 설정만 추가함
- `main`에 없던 `render.yaml`을 새로 만들었다 — `claude/session-a4bq31`의
  실제 운영 정의(`weddingpick-web`/`weddingpick-admin`/`weddingpick-api`)를
  그대로 옮기고, 새 서비스 `weddingpick-app-web`을 추가했다.
- `weddingpick-app-web`: `buildCommand: npm run export:web --workspace
  @weddingpick/mobile`, `staticPublishPath: ./apps/mobile/dist`, expo-router
  클라이언트 라우팅을 위한 `/* → /index.html` rewrite 포함.
- **실제 Render 서비스 생성·배포는 하지 않았다.** 새 유료 리소스이므로 사용자
  승인이 필요하다 — 아래 "사용자 직접 조치 필요" 8번 참고.

### 2. 웹뷰 쉘 — 홈 · Pick 두 화면에 opt-in으로 배선
- `apps/mobile/src/features/webshell/WebShellView.tsx` — `react-native-webview`
  래퍼. `apps/mobile/src/app/(tabs)/index.tsx`(홈), `.../pick/index.tsx`(Pick)에
  연결.
- **기본값은 꺼짐이다.** `EXPO_PUBLIC_WEBSHELL_SCREENS` 환경변수(쉼표 목록, 예
  `"home,pick"`)에 화면 id가 들어있을 때만 그 화면이 웹뷰로 바뀐다
  (`features/webshell/config.ts`). eas.json에는 아무 값도 넣지 않았다 — 즉
  프로덕션·프리뷰 빌드는 지금과 똑같이 100% 네이티브다.
- **왜 opt-in인가**: 홈(`(tabs)/index.tsx`, 통합정책 C-1)과 Pick(`pick/index.tsx`,
  v3.2 §6)은 스텁이 아니라 이미 완성된 네이티브 화면이다. 웹뷰로 무조건 대체하면
  회귀 위험만 있고 얻는 것이 없다 — 그래서 검증용 스위치로만 만들었다. **다른
  세션이 이 방향을 실제 프로덕션 전환으로 오해하지 말 것.** 화면을 웹으로
  대체할지는 이 POC가 정하는 게 아니라 별도 결정이 필요하다.

### 3. 로그인 세션 전달 — 기존 `api/session.ts`를 그대로 재사용
- **결정**: URL 쿼리 파라미터로 최초 1회 전달 + 웹 쪽 저장은 새 메커니즘을 만들지
  않고 기존 `apps/mobile/src/api/session.ts`(`saveToken`/`loadToken`, AsyncStorage
  키 `weddingpick.sessionToken.v1`)를 그대로 쓴다. 웹 export는 같은 코드베이스가
  react-native-web으로 빌드된 것이라 AsyncStorage가 web에서는 localStorage로
  동작하는 폴리필을 그대로 쓰기 때문에 자연스럽게 맞는다.
- **흐름**: `WebShellView`가 `loadToken()`으로 토큰을 읽어 `?wp_token=<token>`을
  최초 진입 URL에 한 번만 붙인다(웹뷰 내부 이동에는 다시 붙이지 않는다) →
  `apps/mobile/src/app/_layout.tsx`(웹 타깃에서도 같은 파일)가 부팅 시
  `wp_token`을 읽어 `saveToken()`으로 저장하고 `history.replaceState`로 주소창·
  히스토리에서 지운다.
- **왜 postMessage나 쿠키가 아닌가**: 토큰이 opaque 문자열 하나뿐이고(리프레시
  토큰·만료시각은 클라이언트에 저장하지 않음, `api/client.ts`도 마찬가지), 서버가
  쿠키 세션을 발급하지 않는다(Bearer 헤더만). 네이티브 웹뷰와 호스팅된 정적
  사이트는 오리진이 달라 쿠키 공유도 애초에 안 된다. 반면 URL 파라미터 → 기존
  저장 함수 재사용은 새 프로토콜 없이 HTTPS 한 번으로 끝나고, 받은 즉시
  `replaceState`로 주소창에서 지워 히스토리·로그에 남지 않는다.

### 4. 네이티브로 유지되는 화면 — 손대지 않음
- WP-RPT-002(이미지 선택): `apps/mobile/src/app/(tabs)/capture/index.tsx`,
  `.../capture/camera.tsx`, `apps/mobile/src/features/capture/pickers.ts`
- WP-NOTI-003(알림 설정): `apps/mobile/src/app/(tabs)/my/notifications.tsx`
- 이번 POC 브랜치에서 이 파일들은 전혀 수정하지 않았다(git diff로 확인됨).

### 5. 아직 안 정한 것 (이 POC가 답하지 않은 부분)
- **웹뷰 내부 라우팅과 RN 라우터 동기화**: 지금은 화면 전체를 웹뷰로 통째로
  바꾸는 구조라, 웹뷰 안에서 (호스팅된 앱의) expo-router가 다른 경로로 이동해도
  네이티브 탭바·스택은 그 사실을 모른다. 웹뷰 화면 안에서 다른 탭으로 가야 하는
  링크를 누르면 어떻게 할지(웹뷰 안에서 그대로 이동 vs `postMessage`로 네이티브
  라우터에 알려서 네이티브 화면 전환) 정하지 않았다.
- **딥링크**: `weddingpick://` 커스텀 스킴이 웹뷰로 대체된 화면을 가리킬 때 동작을
  정하지 않았다.
- **로그아웃 시 웹뷰 쪽 정리**: 네이티브에서 `clearToken()` 호출 시 이미 열려있는
  웹뷰의 localStorage까지 지울지, 다음 로드 때만 반영할지 정하지 않았다.

---

## 🚨 사용자 직접 조치 필요 (Claude 불가)

### 8. 하이브리드 웹뷰 쉘 POC — Render 서비스 생성 필요 (2026-09-04, 도메인 확정 2026-09-05)
**상태**: `render.yaml`에 `weddingpick-app-web` 정의만 추가됨, 실제 서비스
미생성.

**도메인 결정(2026-09-05, 사용자 확정)**: 커스텀 도메인을 별도로 붙이지 않고
Render 기본 서브도메인 `weddingpick-app-web.onrender.com`을 그대로 쓴다. DNS
등록·연결 작업이 필요 없다.

**필요한 조치(사용자만 가능 — Claude는 Render 대시보드 접근 권한 없음)**:
1. Render 대시보드에서 이 저장소의 Blueprint(`render.yaml`)를 동기화하거나
   `weddingpick-app-web` 정적 사이트를 수동 생성 (새 유료 리소스 — 생성
   여부·요금제 확인 필요). 이름을 `weddingpick-app-web`으로 두면 위 도메인이
   그대로 나온다.
2. 생성·배포가 끝나면 운영자는 브라우저로 `https://weddingpick-app-web.onrender.com`에
   바로 접속해 `apps/mobile`의 실제 화면(react-native-web export)을 검수할 수
   있다 — 이 용도만으로는 네이티브 앱 빌드나 아래 3번 설정이 필요 없다.

**아래는 별개 작업(네이티브 앱이 자체적으로 이 URL을 웹뷰로 감싸게 하려는 경우에만 필요, 검수 목적이면 생략 가능)**:
3. 배포된 URL을 `apps/mobile/eas.json`의 `build.preview.env`와
   `build.production.env`에 `EXPO_PUBLIC_WEB_URL`로 추가
4. 실제로 웹뷰 쉘을 켜보려면 빌드 시 `EXPO_PUBLIC_WEBSHELL_SCREENS=home,pick`도
   함께 넣어야 함(기본은 꺼짐)

### 0. 회원탈퇴 정책 — 최종 확정: 자동삭제 + 운영자 개입 (2026-09-02, 사용자 결정)
**상태**: 해결됨. main의 `release-gate.ts`/`withdrawalReady()` 게이트 방식은 채택하지
않는다.

사용자가 두 세션의 다른 구현(main의 정책 확정 전 기능 잠금 vs PR #10의 자동파기+
운영자 개입)을 확인한 뒤 직접 결정했다 — *"회원탈퇴 정책, 자동삭제+운영자개입 쪽으로
최종 확정할게."*

**확정된 구현**(PR #10, `claude/daily-progress-briefing-3k7lez`): 자동파기 유지 +
운영자 조회·HOLD·RESUME·RETRY·감사로그(`packages/domain/src/withdrawal.ts`,
`apps/api/src/withdrawal-admin.ts`, 마이그레이션 0055·0058).

**PR #10을 병합하는 세션이 할 일**:
- main의 `packages/domain/src/withdrawal.ts`(release-gate 버전)와
  `packages/domain/src/release-gate.ts`의 `withdrawalReady()` 의존을 걷어내고
  PR #10의 구현으로 교체(PR #10 자체는 이미 이렇게 병합해뒀다).
- `WITHDRAWAL_NOTICE`(§J-3)로 확정한 문구가 있다면 PR #10의 실제 탈퇴 화면 문구와
  맞는지 확인 — 서로 다른 문구가 화면에 남지 않게.
- `docs/통합정책 v3.15`와 실제 탈퇴 구현의 정합성을 확인.

### 1. iOS EAS 빌드 수정 — 최우선
`PROJECT_STATUS.md`의 최신 장애 기록은 Release #13의 Provisioning Profile에
Sign in with Apple capability/entitlement가 빠진 것이다. ASC API Key 등록 완료 기록이
있으므로 예전 #1~#10의 미등록 원인을 현재 원인으로 사용하지 않는다.

Apple Developer App ID `kr.weddingpick.app`의 Sign in with Apple 활성화를 확인하고,
EAS iOS Provisioning Profile을 재생성한 뒤 Production Build·TestFlight를 검증한다.
외부 콘솔 변경 완료 여부는 미검증이며, 최신 실패 로그 확인 없이 키를 교체하지 않는다.

### 2. Production DB 마이그레이션 적용
현재 남은 일은 운영 DB의 0052~0062 적용 이력과 main의 0068 변경 적용 결과 확인이다.
코드 병합·헬스체크 성공만으로 마이그레이션 완료로 판정하지 않는다.
아래 0052 enum 실패 설명은 분리 수정 전 이력이며, 현재 코드의 실패를 재확인한 결과가 아니다.
```
# GitHub Actions → db-migrate.yml → Run workflow
# 또는 직접:
DATABASE_URL=<neon-connection-string> npm run migrate --workspace @weddingpick/db
```
적용 대상: `0052_mission_draw.sql` (미션 완료 추적 + 월간 웨딩지원금 추첨 스키마)

**과거 수정 전 실패 기록:** `ALTER TYPE reward_kind ADD VALUE 'monthly_draw'`를
같은 트랜잭션 안에서 바로 쓰는 CHECK 제약(`grant_source_matches_kind`)이 있어
Postgres가 "unsafe use of new value of enum type"으로 매번 실패한다(빈 DB에서
직접 재현·확인함). PR #10 브랜치에서 0052를 두 부분으로 나누고, 값을 더하는 것과
쓰는 것을 각각 새 마이그레이션(`0053_reward_kind_monthly_draw.sql`,
`0054_grant_source_matches_kind.sql`)으로 분리해 고쳤다 — main에 병합되지 않은
채로는 그대로 적용해도 실패한다.

### 4. 앱스토어 출시 블로커 — terms.url / privacy.url
`assertReleasable('production')`이 `terms.url` · `privacy.url` 미설정 시 throw → 앱스토어 출시 불가.  
URL 확정 후 도메인 상수(`packages/domain/src/constants/policy.ts` 또는 유사 위치) 업데이트 필요.  
`privacy.url`이 설정되면 `withdrawalReady() = true`로 릴리즈 게이트 자동 통과. 별도 코드 수정 불필요.

### 5. Gmail 커넥터 연결
Google 개발자 콘솔 알림 자동화 세션이 Gmail 미연결로 차단됨.  
claude.ai Settings → Connectors → Gmail 연결 필요.

### 6. 지도 보기 — 카카오맵 외부 연결로 전환
**채택한 방식**: 앱 내부 카카오 지도 SDK가 아니라 공식 카카오맵 링크
(`https://map.kakao.com/?q=...`)를 연다. 전환된 외부 연결 경로에는 Google Maps 키가 필요 없다.
카카오맵 사용 설정·플랫폼 키 활성화는 운영 문서의 기록이며, 이번에는 콘솔을 재검증하지 않았다.

| 경로 | 코드 확인 결과 | 남은 작업 |
|---|---|---|
| `features/search/vendor-map.tsx` | 업체 선택 후 카카오맵 링크 열기 | Android/iOS 실기기에서 결과·복귀 확인 |
| `(tabs)/search/[vendorId]/index.tsx` | 업체명·지역으로 카카오맵 링크 열기 | 실제 위치 검색 결과 확인 |
| `(tabs)/wedding/[id]/map.tsx` | `react-native-maps`의 MapView 사용 잔존 | 채택한 카카오맵 방식과 통일 필요 |
| 검색·우리웨딩 `map.web.tsx` | 앱 이용 안내만 표시 | 웹에서 외부 링크를 제공할지 범위 확정 후 반영 |

`package.json`의 `react-native-maps`, `app.json`의 관련 플러그인·Google Maps 설정도
남아 있다. 따라서 의존성 제거 완료로 기록하지 않는다. 우리웨딩 사용처를 전환한 뒤 정리한다.
`expo-location` 플러그인 제거는 PR #53에서 main(5b0479b)에 반영됐다. 현재 위치 기능 영향과 main 배포 결과는 별도 확인한다.

### 7. 지도 보기 — 업체 좌표 지오코딩 실행
`0062_vendor_geo.sql` 적용 후 기존 업체는 전부 `lat`/`lng`가 NULL이다(좌표 없이 목록에는
그대로 뜨고 지도에만 안 뜬다). `scripts/geocode-vendors.mts`를 카카오 REST API 키로 돌려야
좌표가 채워진다. 좌표 백필은 외부 카카오맵 열기와 별도 작업이며, 링크 열기의 선행 조건은 아니다. 카카오 개발자 콘솔에서
키 발급 필요(Claude 불가).
```
DATABASE_URL=<neon-connection-string> KAKAO_REST_API_KEY=<발급받은 키> \
  npx tsx scripts/geocode-vendors.mts
```

---

## 세션 운영 구조 (2026-09-09 전면 정리)

세션과 루틴을 역할 기준 5개로 통합했다. **기능마다 새 세션·루틴을 만들지 않는다.**
과거 세션 44개 중 활성 20개를 정리해 아래 5개만 남기고 나머지는 종료(아카이브)했다.
종료한 세션의 작업물은 전부 main 또는 원격 브랜치에 있다 — 대화는 복원하지 않는다.

### 활성 세션 7개

| 세션 | ID | 담당 |
|---|---|---|
| WeddingPick MASTER | `session_01RHos8CRUgW7VXAnxs2BwjD` | 전체 조율 · 정책 · 우선순위 · 진행 상태 · 작업 분배. 직접 구현은 최소화 |
| WeddingPick FE | `session_01MZiSWesap8CuxobSyGWodh` | 모바일/웹 UI · UX · 온보딩 · 화면 구현 · 프론트 QA/PR |
| WeddingPick BE | `session_0168q4Vv8AeFiTN4AfFtDkP9` | API · DB · 인증 · 배치 · 마이그레이션 · 서버 |
| WeddingPick DATA | `session_01MXSCVKR29GAZWPTr9FsLM2` | 업체·공공 정보 수집 · 크롤링 · 자동화 · 정제 |
| WeddingPick RELEASE | `session_01116ZtAK5g2tZT9RToadrfv` | CI/CD · EAS · Android/iOS · 스토어 · 배포/인프라 |
| WeddingPick 알림톡 | `session_016TtFWvSqNa24ck593iAoKp` | 알림 채널 중앙화 · 카카오 알림톡 정책과 구현 |
| WeddingPick 홍보 자동화 | `session_014Vxuyp3FYqihn7D5iPFm9Y` | 마케팅 문구 · 캠페인 화면 · 홍보 파이프라인 |

세션 태그는 `weddingpick` + `wp-master` / `wp-fe` / `wp-be` / `wp-data` / `wp-release` /
`wp-alimtalk` / `wp-promo`.

**DATA 세션이 한때 둘이었다(2026-09-09).** `session_01Nd4sgG6xYjyadUahtrEtMd`는 같은 역할의
중복이라 인계 후 보관 처리했다. 그 세션의 작업물은 PR #135(브랜치 `claude/data-collect-refine-d1d3`)에
남아 있고 위 DATA 세션이 이어받는다. 이 표의 ID를 그 세션으로 고쳤다.

### 운영 규칙

- Source of Truth는 과거 대화가 아니라 Git이다 — 최신 코드 · `CLAUDE.md` ·
  `PROJECT_STATUS.md` · 이 파일 · `docs/design-handoff/current/`의 최신 md.
- 새 세션은 과거 대화 전체를 옮겨받지 않는다. Git과 관련 파일만 읽고 시작한다.
- 지시는 MASTER에서 각 영역 세션으로 간다. 영역 세션끼리 같은 파일을 동시에 고치지 않는다.
- 컨텍스트 40~60%에 도달하면 상태를 Git에 최소 반영한 뒤 같은 역할의 새 버전 세션으로 교체한다.
  교체 시 이 표의 ID를 갱신한다(공정률 브리핑 루틴이 이 절을 읽는다).
- 남기는 정보는 **확정 결정사항 · 미완료 · 블로커** 셋뿐이다. 이미 코드 · 커밋 ·
  정책서에 있는 내용은 여기 다시 적지 않는다.

### 보고 경로 — 사용자에게 직접 올리지 않는다 (2026-09-09 사용자 오더)

막힌 것 · 실패 · 위험 · **사용자가 골라야 하는 것**은 사용자에게 직접 올리지 않고
MASTER(`session_01RHos8CRUgW7VXAnxs2BwjD`)를 거친다. 스스로 판단해 진행할 수 있는 것은
그냥 진행한다 — 이 규칙은 사용자 눈에 닿아야 하는 것만 모으라는 뜻이지 사소한 것까지
올리라는 뜻이 아니다. 급하지 않은 진행 상황은 모아서 한 번에 보내고, 같은 내용을
반복해 보내지 않는다. CI 실패는 담당 세션이 먼저 고치고, 두 번 고쳐도 안 되면 올린다.

올릴 때 반드시 담을 것 넷:

1. 무슨 일인지 한 줄
2. 지금 무엇이 안 되는지 — 영향 범위
3. 사용자가 골라야 하는 것이면 **선택지와 권고안**
4. 근거 파일·줄, 또는 워크플로 실행 링크

보내는 법 — `create_trigger`로 MASTER 세션에 1회만 쏜다. 새 세션은 이 문단만 읽고
그대로 따라 할 수 있어야 한다.

```
mcp__Claude_Code_Remote__create_trigger
  name                   보고 제목 한 줄
  persistent_session_id  session_01RHos8CRUgW7VXAnxs2BwjD   (MASTER · 위 표의 ID)
  initiation             own_followup
  run_once_at            지금부터 1~2분 뒤 (RFC3339 · 예 2026-09-09T03:11:00Z)
  prompt                 위 네 가지를 담은 보고 본문
```

`cron_expression`은 쓰지 않는다 — 보고는 일회성이고, 반복 루틴을 만들면 같은 보고가
계속 쌓인다. MASTER 세션 ID가 바뀌면 위 표와 이 문단의 ID를 함께 갱신한다.

세 가지가 더 있다. 이것 때문에 이 규칙이 생겼다.

- **사람만 할 수 있는 것**(시크릿 값 · 외부 계정 · 계약 · 권한)은 세션이 스스로 못 푼다.
  MASTER가 그런 것만 모아 사용자 조치 목록으로 한 번에 올린다.
- **돈이 드는 선택과 되돌리기 어려운 선택은 MASTER도 정하지 않는다.** 선택지와 권고안을
  붙여 사용자에게 올린다. 발송사 계약 · 운영 DB 변경 · 스토어 정책이 그런 자리다.
- **값은 보고에도 적지 않는다.** 접속 문자열 · API 키 · 휴대폰 번호는 이름과 증상만 적는다.
  보고는 저장되고 다시 읽힌다.

### 루틴 (Routines)

| 루틴 | 주기 | 목적 |
|---|---|---|
| 공정률 브리핑 | 매일 09:00 KST | main 기준 공정률 계산·보고. 공정률 정의의 단일 출처. 저장소에 쓰지 않는다 |
| 토요일 크론 차단 확인 | 일회성(MASTER · 2026-09-11) | `public-data.yml`의 무인 운영 DB 쓰기 차단이 main에 들어갔는지. 크론은 2026-09-13 03:17 KST |

- 특정 PR·일회성 지시용 루틴은 만들지 않는다. 필요하면 MASTER 세션에 직접 지시한다.
  부득이하게 만들면 목적 달성 즉시 삭제한다.
- 2026-09-09에 삭제한 루틴 7개: `wedding-couple-final-directive` ·
  `nudge-wedding-couple-2`(WP-OUR-003/010/011은 이미 main에 구현됨) · `pick-ci-recheck`(PR #76 종료) ·
  `FE-1차-PR-오픈` · `FE 1차 PR 오픈 지시`(중복 · PR 오픈 완료) · `PR #16 #21 충돌 해결 지시`(완료) ·
  `WeddingPickl main 변경 감지`(비활성 · 대상 브랜치 폐기).
- 계정에 남아 있는 `매일 09:00 메일함 자동 정리`는 웨딩픽 프로젝트 루틴이 아니다 — 이 정리 대상에서 제외했다.

### 정리 시점의 미완료 · 블로커 (세션 종료로 주인이 없어진 것)

- **PR #131 — 머지 완료**(main `59e8838`). 사용자 오더 6건(카카오 문구 중첩 · 홈 D-day 코랄 ·
  패딩 전면 재검토 · Depth Back · 이동 잔상과 로딩 속도 · 시안 미매핑 화면 1차)이 전부 들어갔다.
- **PR #134 — 머지 완료**(main `451c36c`). 수집 중단 스위치 실연결 · 시드 워크플로의 운영 DB 경로 차단.
- **토요일 크론이 무인으로 운영 DB에 쓴다** — `public-data.yml`의 `17 18 * * 6`이 2026-09-13
  03:17 KST에 뜬다. 막는 변경(대상 선택 · 기본 staging)은 만들어져 있고 PR #133에 얹는 중이다.
  그날 전에 머지되어야 한다. 가장 급한 미완료다.
- **PR #103** — 2026-09-07부터 열린 채로 방치. 루트 `HANDOFF.md`가 저장소에 없는
  `docs/CLAUDE_AUDIT_REVIEW_2026-09-07.md`를 가리키는 것을 고치는 문서 한 줄짜리 PR이다.
  #131 머지 후 main과 맞춰 처리한다. 머지되면 그 브랜치를 포함해 삭제 대상 브랜치가 늘어난다.
- **원격 브랜치 81개** — 대부분 병합 완료·폐기 대상인데 세션 프록시가 ref 삭제를 막아 남아 있다.
  근거와 삭제 명령은 위 «삭제 대기 브랜치» 절. 사용자 또는 권한 있는 환경에서 한 번에 처리한다.
- 그 밖의 미해결 결함·외부 조치 대기 항목은 이 파일의 «미해결 결함» 절과
  `PROJECT_STATUS.md`가 정본이다. 여기에 중복해 적지 않는다.

> 2026-09-09 이전의 세션별 작업 기록(마스터 · FE 1~3차 · BE PR #10/#14/#19/#28/#32 ·
> 하이브리드 QA 5개 등)은 Git history와 각 PR 본문에 남아 있다. 세션 단위 기록은 더 쌓지 않는다.

---

## 프론트엔드 화면 현황

### 기준: 핸드오프 전체 IA (176개 화면 코드)

| 상태 | 수 | 비율 |
|---|---|---|
| 구현됨 | 34 | 19% |
| 부분 구현 | 58 | 33% |
| 미구현 | 49 | 28% |
| 확인 필요 (Bottom Sheet·공통 상태) | 35 | 20% |

**라우터 파일**: `apps/mobile/src/app/` 42개 — 핵심 화면 커버

### 미구현 주요 영역

| 영역 | 미구현 수 | 비고 |
|---|---|---|
| 관리자 화면 (WP-ADM-*) | 25개 | 전부 미구현 |
| 박람회·웨딩 정보 (WP-EXPO-*) | 5개 | 전부 미구현 |
| 공통 Bottom Sheet (WP-SHT-*) | 16개 | 인라인 처리 여부 확인 필요 |
| 공통 상태 (WP-ST-*) | 14개 | 로딩/에러/빈 상태 확인 필요 |
| B2B 문의 (WP-BIZ-*) | 5개 | 소속확인·자료제공·혜택등록·광고·웹Footer |
| 커플 연결 (WP-CPL-*) | 2개 | 공동 편집 충돌, 변경 내역 |
| 우리웨딩 (WP-OUR-*) | 0개 | 일정 추가 ✅(PR #19), 준비 타임라인 ✅(PR #16), 예식 완료 ✅(PR #16) |
| MY (WP-MY-*) | 0개 | 취향 다시 고르기 ✅(PR #16), 회원탈퇴 ✅(PR #10/#15) |
| 홈 (WP-HOME-*) | 2개 | TOP3 전체보기, 개인화 웨딩피드 |
| Pick (WP-PICK-*) | 0개 | WP-PICK-006 결정 완료 ✅(home/fe-p0-gaps) |
| 기타 | ~3개 | 지도 보기 ✅(PR #19), 재실행·세션 복원, 진입 예외 등 |

이 표는 176개 화면 전체 재조사 시점(작성 당시) 기준 카운트라 위 ✅ 항목만큼 실제 미구현
수는 줄었다 — 전체 재집계는 하지 않았다.

상세 목록: https://claude.ai/code/artifact/b99277b7-3bdc-45dc-9614-a1310507df53

---

## DB 스키마 현황

### 마이그레이션 이력 (0001 ~ 0062, 전체 완료)

| 범위 | 내용 |
|---|---|
| 0001 ~ 0010 | 기반 인프라 (users, vendors, API keys 등) |
| 0011 ~ 0020 | 검색·매칭·견적 |
| 0021 ~ 0030 | 소셜·리뷰·알림 |
| 0031 ~ 0038 | Pick·비교·결제·광고 |
| 0039 ~ 0046 | 보상·제보·광고·결혼 지역 |
| 0047 ~ 0051 | 데이터 수집 파이프라인 (vendor_data_quality, change_log, import_run_log, vendor_images, corrections) |
| 0052 ~ 0054 | 미션 완료 추적 + 월간 웨딩지원금 추첨 |
| 0055 ~ 0058 | 회원탈퇴 자동파기 + 운영자 개입, AI 라우터, 이의 만료 |
| 0059 | 소셜 로그인 프로필(`identities.name`/`nickname`/`profile_image_url`) |
| 0060 | 취향(`taste_preferences`) — 홈 C-1 시안 1 |
| **0061** | **일정(`wedding_events`)** — 웨딩 스케줄(체크리스트)과 다른, 일시·장소가 있는 캘린더 이벤트 |
| **0062** | **업체 좌표(`vendors.address`/`lat`/`lng`)** — 지도 보기용, 기본값 없이 지오코딩 전엔 NULL |

**번호 충돌 이력**: PR #19(일정·지도 보기)가 다른 PR과 동시에 진행되며 각자
`0059`·`0060`을 골라 main에 그대로 머지됐다(사회 로그인 프로필·취향 마이그레이션과
파일명이 겹침). 이 파일이 그 충돌을 `0061`·`0062`로 재번호를 매겨 고친다 —
migrate.ts는 파일명 전체를 버전 키로 써서 실제로 깨지지는 않았지만, 번호가 순서를
나타낸다는 규약을 어겼다.

### ⚠️ 프로덕션 미적용
`0052_mission_draw.sql`부터 `0062_vendor_geo.sql`까지 코드 리포에는 머지됐으나 Neon
production DB에는 아직 미적용. `db-migrate.yml` 워크플로 실행 필요.

---

## 백엔드 API 현황

- **테스트**: 524개 통과 (백엔드 관리 세션 기준, 2026-09-02)
- **서버**: `https://weddingpickl.onrender.com` (Render)
- **미확인**: 프로덕션 환경 전체 API 엔드포인트 수, 커버리지 %

---

## 코드 구조 주요 경로

```
WeddingPickl/
├── apps/
│   ├── mobile/              # Expo Router 모바일 앱
│   │   └── src/app/         # 42개 라우터 파일 (화면)
│   └── api/                 # Hono API 서버 (Render 배포)
├── packages/
│   ├── db/
│   │   └── migrations/      # 0001 ~ 0052 SQL 파일
│   ├── domain/              # 도메인 상수·정책 (terms.url, privacy.url 여기)
│   └── ...
├── docs/
│   ├── 통합정책 v3.15       # 현재 확정 기준 정책
│   ├── design-handoff/      # 디자인 핸드오프 (IA 176화면)
│   ├── AI_HANDOFF.md        # 이 파일
│   └── 05-product-spec.md   # Phase 1 제품 스펙 (A-01~A-18)
└── .github/workflows/       # CI/CD 워크플로
```

---

## 정책 문서 참조

기준: `docs/통합정책 v3.15`
코드와 정책이 충돌하면 **정책이 맞다.** 코드를 고친다.

주요 섹션:
- `§I-4` — 월간 웨딩지원금 추첨 (4개 미션 완료 조건, Npay 5만원×2명)
- `§J-3` — 탈퇴 화면 UX 문구
- `§A~§H` — 업체·검색·Pick·비교 핵심 정책

---

## 다음 작업 우선순위

1. **[AI]** PR #51·#53은 병합 완료. main(5b0479b)의 CI·마이그레이션·배포 결과와 핵심 흐름 검증
2. **[AI — 최우선]** 관리자 API 엔드포인트 추가 (`apps/api/src/routes/admin.ts`)
   - 최소: dashboard, faq, users, vendors, revenue, kill-switches, audit-log
   - 전체 목록: 위 "관리자 API 실질적 갭" 표 참고
3. **[사용자]** Release #13의 Sign in with Apple 권한·Provisioning Profile 수정 여부 확인 → iOS 빌드·TestFlight 검증
4. **[사용자]** Neon DB: `db-migrate.yml` 실행 → 0052 ~ 0062 적용
5. **[사용자]** terms.url · privacy.url 확정 → 도메인 상수 업데이트
6. **[AI/사용자]** 카카오맵 전환 잔여 경로·의존성 정리, Android/iOS 외부 링크 실기기 검증 (위 6번)
7. **[사용자]** 카카오 REST API 키 발급 → `scripts/geocode-vendors.mts` 실행해 업체 좌표 채우기
8. **[AI]** 공통 Bottom Sheet 16종 인라인 처리 여부 확인
9. **[사용자]** `weddingpick-app-web` Render 정적 사이트 생성(도메인 확정: 기본
   서브도메인 `weddingpick-app-web.onrender.com` 그대로 사용, 2026-09-05) — 위
   "사용자 직접 조치 필요" 8번 참고. 생성되면 운영자가 그 URL로 실제 앱 화면을
   바로 검수할 수 있다.
9. **[완료]** WP-PICK-006 결정 완료 화면(`pick/done.tsx`) 구현 — PR #51 포함

---

## 변경 금지 / 주의

- `--no-verify` 사용 금지
- 마이그레이션 파일 번호 순서 역행 금지 (0052 다음은 0053)
- `main` 브랜치 직접 푸시 금지 — 항상 PR 경유
- `assertReleasable('production')` 우회 금지 — terms.url/privacy.url 설정이 올바른 해결책
- expo.dev 크리덴셜은 Claude가 접근 불가 — 사용자 직접 처리

---

## 롤백

| 항목 | 롤백 방법 |
|---|---|
| DB 마이그레이션 0052 | `0052_mission_draw.sql` DROP 구문 없음 — 수동 롤백 필요 |
| release.yml | git revert로 이전 커밋 복원 |

---

## 프론트엔드 화면별 상세 갭 분석 (디자인 핸드오프 21개 화면 기준)

> 아래는 `docs/design-handoff/README.md` 기준 21개 화면을 코드와 1:1 대조한 결과다.
> 참고: `docs/design-handoff/웨딩픽 앱 v7.dc.html`은 레포에 없어 README 기준으로 분석.

### 우선순위별 핵심 갭

**높음 — 사용자가 바로 체감:**
1. **인증후기 섹션 완전 누락** — `apps/mobile/src/app/(tabs)/search/[vendorId]/index.tsx` 업체 상세에서 후기를 직접 볼 수 없음, 별도 탭으로만 이동
2. **카메라 가이드 없음** — `capture/camera.tsx`: 3:4 프레임 없음, 밝기·흔들림·잘림 품질 피드백 없음
3. **동의 체크박스 없음** — `capture/payment/consent.tsx`: 전체 동의 Checkbox 미구현, 동의 전 CTA 비활성 로직 없음

**중간 — 정책·UX 이슈:**
4. **파괴적 동작 컨펌 없음** — `tasks.tsx`(체크리스트 삭제), `visit-notes.tsx`(방문노트 삭제) — 다이얼로그 없이 직접 삭제
5. **홈 다음 일정 섹션 대체** — 디자인의 "다음 일정" 고정 섹션이 Priority Engine 카드로 교체됨
6. **홈 편집 드래그 없음** — `home-edit.tsx` 주석에 인지됨, 위/아래 버튼으로 대체

**낮음 — 비주얼 세부:**
7. 스플래시 심볼 88px (디자인 64px) — `features/splash/splash-view.tsx`
8. 미션 완료 모달 바운스 애니메이션 없음 — `(tabs)/my/index.tsx`
9. 검색 자동완성 드롭다운 없음 — `(tabs)/search/index.tsx`
10. 지출 현황 ⓘ 툴팁 없음 — `(tabs)/index.tsx`

### 화면별 상태 요약

| # | 화면 | 상태 | 핵심 누락 |
|---|---|---|---|
| 0 | 스플래시 | ⚠️ | 심볼 88px (설계 64px) |
| 1 | 온보딩 | ✅ | 경미한 레이아웃 차이만 |
| 2 | 이름·예식일 등록 | ⚠️ | 이름 필드 없음, 지역·예산 추가 (정책 변경) |
| 3 | 예식일 캘린더 | ✅ | WeddingCalendar 컴포넌트로 정상 구현 |
| 4 | 로딩 스켈레톤 | ⚠️ | 탭바 숨김 여부, 1.6초 고정 여부 미확인 |
| 5 | 홈 | ⚠️ | 다음 일정→Priority Engine, 지출 툴팁 없음 |
| 6 | 홈 편집 | ⚠️ | 드래그 없음 (버튼 대체, 주석에 인지됨) |
| 7 | 검색 | ⚠️ | 자동완성 없음, 정렬 드롭다운→칩 |
| 8 | 업체 상세 | ⚠️ | **인증후기 섹션 없음**, 상담연결·영업상태 없음 |
| 9 | 비교함 | ⚠️ | "순위 안 매김" 문구, "의견 공유하기" 확인 필요 |
| 10 | 결제내역 등록 동의 | ⚠️ | **전체 동의 Checkbox 없음** |
| 11 | 촬영 | ⚠️ | **3:4 가이드 프레임 없음**, **품질 피드백 없음** |
| 12 | 읽은 내용 확인 | ⚠️ | A-05~A-10 분리 구현, 상세 확인 필요 |
| 13 | 등록 완료 | ⚠️ | 파일 존재, 내용 확인 안 됨 |
| 14 | 지출내역 | ⚠️ | 삭제 컨펌 없음 |
| 15 | 웨딩 스케줄 | ⚠️ | "직접 지정" 표기, 삭제 컨펌 확인 필요 |
| 16 | 방문노트 | ⚠️ | 삭제 컨펌 없음 |
| 17 | MY | ⚠️ | 메뉴 구조 다름, 추가 항목 있음 |
| 18 | 미션 완료 모달 | ⚠️ | **바운스 애니메이션 없음** |
| 19 | 설정 | ⚠️ | 가격 변동 알림 Switch 확인 필요 |
| 20-알림 | 알림 | ✅ | 정상 구현 |
| 20-배우자 | 배우자 연결 | ✅ | 정상 구현 |
| 20-제보 | 내 제보 내역 | ✅ | 정상 구현 |
| 20-반론 | 업체 반론 등록 | ✅ | 정상 구현 |
| 20-문의 | 문의하기 | ✅ | 정상 구현 |
| 20-약관 | 약관·정책 | ✅ | 정상 구현 |

### 공통 횡단 갭

**파괴적 동작 컨펌 다이얼로그 누락:**
| 대상 | 파일 | 상태 |
|---|---|---|
| 체크리스트 삭제 | `(tabs)/wedding/[id]/tasks.tsx` | ❌ 직접 삭제 |
| 방문노트 삭제 | `(tabs)/wedding/[id]/visit-notes.tsx` | ❌ 직접 삭제 |
| 비용 항목 삭제 | `(tabs)/wedding/[id]/expenses.tsx` | ❌ 직접 삭제 |
| 배우자 연결 해제 | `(tabs)/wedding/partner.tsx` | ✅ 2단계 구현 |
| 로그아웃 | `(tabs)/my/settings.tsx` | ✅ Alert 사용 |

### 정책 변경으로 의도적 차이 (버그 아님)
- 이름 필드 제거: v3.10 §3
- "배우자와 실시간 공유" Switch 제거: v2.0 원문 30번 폐기
- 상담연결 CTA 없음: 앱이 중개하지 않는 원칙
- 잠금 카드 대신 stage 기반: v2.0 K-6 잠금 폐기

### 디자인에 없지만 추가 구현된 화면
업체 관계자 인증(`my/vendor-claims/`), 친구초대·홍보인증(`my/rewards.tsx`), 촬영 안내(`my/guide.tsx`), 플래너 상세(`search/planner/[plannerId].tsx`), 샘플 미리보기(`capture/sample.tsx`) 등

---

## 이전 세션(디자인·인프라) 추가 노트

## 변경 금지 / 주의
- do_not_change:
  - **회원탈퇴 자동 삭제 백엔드를 만들지 말 것.** `packages/domain/src/withdrawal.ts`의 `WITHDRAWAL_NOTICE`가 개인정보처리방침 확정 전까지 `null`인 명시적 게이트다. 스키마상 `structured.users` 하드 삭제는 FK CASCADE로 확인된 정보(quotes)까지 지운다 — 위험. `payment_proofs`/`price_reports`를 "통계 제외"할지 "익명화 유지"할지도 정책 §46이 명확히 안 정했다. 이 정책들이 정해지기 전엔 손대지 말 것.
  - Npay·월간 웨딩지원금 기능을 만들지 말 것(위 미완료 항목 참조, 개인정보 처리방침과 함께 정리해야 함).
  - 네이버 authorization code 교환과 프로필 조회 경로가 구현됐다. 서버와 앱 환경값 및 네이버 Developers callback URL이 모두 설정된 경우에만 노출한다(`docs/social-login-handoff.md` 참조).
  - `docs/design-handoff/current/`는 원본 그대로 유지 — 화면 구현할 때 이 폴더 안의 `.dc.html` 파일을 직접 고치지 않는다(참고용 원본). 옛 `seed/`는 v3.11 반영 시점(2026-09-06)에 삭제했다.

## 롤백
- rollback_note: 커밋 4개(`f22a512`, `bba48ed`, `10ce66a`, `cf07b15`)는 서로 기능적으로 독립적이라 필요하면 개별 `git revert <hash>`로 되돌릴 수 있다. 순서상 뒤 커밋이 앞 커밋의 파일을 다시 건드리지 않으므로 역순 revert도 안전하다. 전부 origin/main에 push 완료 — 로컬에만 있는 미커밋 변경 없음(`.npm-cache/` 잡음 제외).

---

## 공정률 대시보드 (2026-09-02 추가)

`npm run progress`(이 저장소가 이미 갖고 있던 계산기)의 결과를 눈으로 보기 편하게 만든 Artifact를 만들어뒀다: **https://claude.ai/code/artifact/bf90e7aa-91ad-4df3-bcbd-dc950216663a**

- `db` capability로 발행했다. `snapshot/latest` 문서에 `npm run progress -- --format json`을 사람이 보기 좋은 모양으로 변환한 값을 담아두면, 열려 있는 페이지가 새로고침 없이 갱신된다.
- 갱신 방법: `npm run progress -- --format json`을 돌리고 그 결과를 대시보드가 기대하는 모양(`overallRate`, `items[]`, `inventory[]`, `openSections[]`, `unanswered[]`, `decisionSections[]`, `commits[]` 등 — 위 URL의 아티팩트 소스 상단 `FALLBACK` 상수를 참고)으로 옮긴 다음, Artifact 도구의 `write_db`로 `collection: "snapshot"`, `doc_id: "latest"`에 `set` 하면 된다. 사용자가 "progress 다시 돌리고 대시보드 갱신해줘"라고 하면 이 흐름을 그대로 하면 된다.
- 이 문서 위쪽 "변경 금지" 절이 회원탈퇴 자동삭제 백엔드를 만들지 말라고 적어뒀는데, 그 뒤 커밋(`e42d7c4`, `549e2fa` 등)에서 실제로 자동삭제 + 운영자 개입 기능이 만들어진 것으로 보인다 — **그 절이 낡았을 수 있다.** 다음 세션은 `packages/domain/src/withdrawal.ts`와 관련 마이그레이션(`0055_account_deletion.sql`, `0058_withdrawal_admin.sql`)을 직접 열어 지금 상태를 확인하고, 이 문서의 "변경 금지" 절을 현재 상태에 맞게 고칠 것.

