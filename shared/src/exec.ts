import * as exec from '@actions/exec';
import * as core from '@actions/core';

export async function execWithLog(
  command: string, 
  args?: string[], 
  options?: exec.ExecOptions
): Promise<void> {
  core.info(`Executing: ${command} ${args?.join(' ') || ''}`);
  await exec.exec(command, args, options);
}

export async function getExecOutput(
  command: string,
  args?: string[],
  options?: exec.ExecOptions
): Promise<string> {
  let stdout = '';
  let stderr = '';
  await exec.exec(command, args, {
    ...options,
    listeners: {
      stdout: (data: Buffer) => {
        stdout += data.toString();
      },
      stderr: (data: Buffer) => {
        stderr += data.toString();
      },
    },
  });
  if (stderr) {
    core.debug(`stderr: ${stderr.trim()}`);
  }
  return stdout.trim();
}
