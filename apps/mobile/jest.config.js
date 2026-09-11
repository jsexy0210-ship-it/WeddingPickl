/**
 * **`testTimeout`을 둔다 — jest 기본값 5초는 화면을 그리는 시험에 모자란다.**
 *
 * `depth-back-buttons.test.tsx`의 첫 시험이 2026-09-11 CI에서 두 번 죽었다
 * (run 34562339488 · 34567734303). 단정이 깨진 것이 아니라 시간이 넘었다 —
 * `thrown: "Exceeded timeout of 5000 ms for a test."`
 *
 * 그 시험은 평소 275ms에 끝난다. 파일 맨 위에서 실제 화면 셋을 import하고
 * **그 적재·첫 렌더 비용을 파일의 첫 시험이 혼자 내기 때문에**, 러너가 눌리면
 * 그 한 줄만 예산을 넘긴다(뒤 여덟 개는 2~5ms). 같은 커밋이 로컬에서는
 * 전체 통과했고 CI에서는 세 번 중 두 번 죽었다.
 *
 * 값을 늘리는 것은 시험을 끄거나 건너뛰는 것이 아니다 — 단정은 그대로이고
 * 느려진 것을 기다려 줄 뿐이다. 정말 멈춘 시험은 30초에 그대로 잡힌다.
 *
 * `apps/api`와 `packages/db`가 이미 같은 것을 한다(둘 다 `testTimeout: 60000`).
 * 여기만 기본값이었다. 30초는 실측 최악(6.4초)의 다섯 배다.
 */
module.exports = {
  testTimeout: 30000,
  preset: 'jest-expo',
  setupFiles: ['<rootDir>/jest.setup.js'],
  testMatch: ['**/*.test.ts', '**/*.test.tsx'],
  /**
   * 시험 하나의 제한. jest 기본값은 5초다.
   *
   * **시험이 느린 것이 아니라 첫 변환이 느리다.** jest-expo는 화면과 그 의존성을
   * 실제로 렌더할 때 babel로 바꾸는데, 그 값이 **그 파일 첫 `it` 안에서** 든다.
   * 캐시가 따뜻하면 그 케이스가 212ms지만 캐시를 비우면 3,663ms다(2026-09-11
   * `depth-back-buttons.test.tsx` 실측). **CI 러너는 매번 차갑다.**
   *
   * 그래서 5초 선에 여러 파일이 붙어 있었다 — 같은 판의 CI에서 next-after-sign-in
   * 6.8초 · app-journey 5.8초 · signup-recovery 5.6초였고, depth-back-buttons가
   * 6.0초로 넘어가 서로 다른 두 PR이 같은 자리에서 막혔다.
   *
   * 20초는 그 변환 값을 덮되 **진짜 회귀는 그대로 잡는 선**이다. 시험을 끄거나
   * 건너뛰지 않는다 — 전부 그대로 돌고 그대로 검증한다.
   *
   * 첫 케이스로 값이 몰리는 것 자체는 jest가 `beforeAll` 시간을 첫 시험에
   * 포함시켜서 셋업으로 옮겨도 줄지 않는다(같은 날 확인).
   */
  testTimeout: 20_000,
  forceExit: true,
  openHandlesTimeout: 0,
  clearMocks: true,
  resetMocks: true,
  restoreMocks: true,
};
