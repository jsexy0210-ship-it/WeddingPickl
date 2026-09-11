module.exports = {
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
