/**
 * 알림톡 템플릿의 타입과 검증.
 *
 * **문안은 여기 없다.** 정본은 `spec/alimtalk.templates.json` 하나고, 이 파일은
 * 그것을 읽은 결과가 쓸 만한지만 본다. 문안을 코드로 한 번 더 옮겨 적으면
 * 카카오에 승인된 글자와 코드의 글자가 언젠가 갈라지고, 갈라진 순간 발송이
 * 통째로 반려된다.
 */

export type AlimtalkTemplate = {
  templateId: string;
  situation: string;
  /** 본문에 쓰는 치환자 이름. `#{senderName}`의 `senderName`이다. */
  variables: readonly string[];
  button: string;
  /** 카카오 템플릿 심사를 통과했는가. 통과 전에는 알림톡을 보내지 않는다. */
  approved: boolean;
  /** 심사에 등록한 원문 그대로. */
  body: string;
};

const PLACEHOLDER = /#\{([A-Za-z][A-Za-z0-9_]*)\}/g;

/** 본문에 실제로 박힌 치환자들. 나온 순서대로, 중복은 한 번만. */
export function bodyPlaceholders(body: string): string[] {
  const found = new Set<string>();

  for (const match of body.matchAll(PLACEHOLDER)) {
    found.add(match[1]!);
  }

  return [...found];
}

/**
 * 선언한 변수 목록과 본문이 어긋난 곳.
 *
 * 두 벌을 적게 되어 있으니 갈라질 수 있다 — 갈라지면 «변수 누락»이 발송 직전이
 * 아니라 테스트에서 잡혀야 한다.
 */
export function templateMismatch(template: AlimtalkTemplate): {
  missingInBody: string[];
  undeclared: string[];
} {
  const inBody = bodyPlaceholders(template.body);

  return {
    missingInBody: template.variables.filter((name) => !inBody.includes(name)),
    undeclared: inBody.filter((name) => !template.variables.includes(name)),
  };
}

/**
 * 값이 오지 않은 변수.
 *
 * 빈 문자열도 누락으로 본다. `#{businessName}`이 빈 채로 나가면 사용자는 어느
 * 업체 이야기인지 모르는 알림을 받는다.
 */
export function missingVariables(
  template: AlimtalkTemplate,
  values: Readonly<Record<string, string>>
): string[] {
  return template.variables.filter((name) => {
    const value = values[name];
    return value === undefined || value.trim().length === 0;
  });
}

/**
 * 보낼 수 있는 값인지 확인한다. 하나라도 비면 던진다.
 *
 * 던지는 쪽을 고른 이유: 변수가 빈 알림톡은 이미 승인된 문안과 다른 글이고,
 * 그건 보내고 나서 고칠 수 있는 실수가 아니다.
 */
export function assertVariables(
  template: AlimtalkTemplate,
  values: Readonly<Record<string, string>>
): void {
  const missing = missingVariables(template, values);

  if (missing.length > 0) {
    throw new Error(`${template.templateId} 템플릿 변수가 비었다: ${missing.join(', ')}`);
  }
}
