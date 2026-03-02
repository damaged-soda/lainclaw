export function buildPairingReply(params: {
  channel: string;
  idLine: string;
  code: string;
}): string {
  const command = `lainclaw pairing approve --channel ${params.channel} ${params.code}`;
  return [
    "Lainclaw: access not configured.",
    "",
    params.idLine,
    "",
    `Pairing code: ${params.code}`,
    "",
    "请让管理员执行以下命令完成配对：",
    command,
  ].join("\n");
}

export function buildPairingQueueFullReply(): string {
  return [
    "Lainclaw pairing requests 已达到上限，请稍后再试。",
    "你可以向管理员确认是否已有太多未处理的待审批请求。",
  ].join("\n");
}
