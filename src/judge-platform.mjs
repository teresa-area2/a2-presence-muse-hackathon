// This is a preflight boundary, not a claim that either allowed OS is qualified.
export function judgePlatform(platform = process.platform) {
  if (platform === 'darwin' || platform === 'linux') return {allowed: true, code: null};
  if (platform === 'win32') return {allowed: false, code: 'judge_install_process_group_unavailable'};
  return {allowed: false, code: 'judge_platform_unsupported'};
}

export function assertJudgePlatform(platform = process.platform) {
  const result = judgePlatform(platform);
  if (!result.allowed) throw Error(result.code);
}

export function judgePlatformMessage(error, platform = process.platform) {
  if (platform === 'win32' && error?.message === 'judge_install_process_group_unavailable') return 'Native Windows is not supported. Use WSL2 and follow docs/JUDGE-QUICKSTART.md.';
  if (error?.message === 'judge_platform_unsupported') return 'This operating system is not supported. Use macOS or Linux; Windows users can use WSL2. See docs/JUDGE-QUICKSTART.md.';
  return null;
}
