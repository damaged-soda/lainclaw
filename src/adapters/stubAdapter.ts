import { RequestContext } from '../shared/types.js';

export interface AdapterResult {
  route: string;
  stage: string;
  result: string;
  provider?: string;
  profileId?: string;
}

export function runStubAdapter(context: RequestContext, route: string): AdapterResult {
  const normalizedInput = context.input.trim();
  if (route === 'summary') {
    return {
      route,
      stage: 'adapter.stub.summary',
      result: `[stub-summary] 我已接收到你的内容：${normalizedInput}`
    };
  }

  return {
    route,
    stage: 'adapter.stub.echo',
    result: `[stub-echo] 已接收到输入：${normalizedInput}`
  };
}
