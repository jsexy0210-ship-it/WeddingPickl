import {
  assertVariables,
  bodyPlaceholders,
  missingVariables,
  templateMismatch,
  type AlimtalkTemplate,
} from './alimtalk-template';

const template: AlimtalkTemplate = {
  templateId: 'WP_TEST',
  situation: '시험',
  variables: ['businessName', 'reason'],
  button: '확인하기',
  approved: false,
  body: '#{businessName}에 등록한\n사유: #{reason}',
};

describe('알림톡 템플릿 검증', () => {
  it('본문의 치환자를 나온 순서대로 찾는다', () => {
    expect(bodyPlaceholders(template.body)).toEqual(['businessName', 'reason']);
  });

  it('선언한 변수와 본문이 맞으면 어긋난 곳이 없다', () => {
    expect(templateMismatch(template)).toEqual({ missingInBody: [], undeclared: [] });
  });

  it('본문에만 있는 치환자와 선언에만 있는 변수를 각각 짚는다', () => {
    const broken: AlimtalkTemplate = {
      ...template,
      variables: ['businessName', 'deadline'],
      body: '#{businessName} · #{reason}',
    };

    expect(templateMismatch(broken)).toEqual({
      missingInBody: ['deadline'],
      undeclared: ['reason'],
    });
  });

  it('빈 값은 누락으로 본다 — 업체 이름이 빈 알림은 어느 업체 이야기인지 알 수 없다', () => {
    expect(missingVariables(template, { businessName: '강남 A 스튜디오', reason: '  ' })).toEqual([
      'reason',
    ]);
  });

  it('값이 다 차면 통과하고, 하나라도 비면 던진다', () => {
    expect(() =>
      assertVariables(template, { businessName: '강남 A 스튜디오', reason: '사진 확인 필요' })
    ).not.toThrow();

    expect(() => assertVariables(template, { businessName: '강남 A 스튜디오' })).toThrow('reason');
  });
});
