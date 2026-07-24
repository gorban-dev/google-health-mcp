import { createInterface } from "node:readline/promises";

export const rl = createInterface({ input: process.stdin, output: process.stderr });

export function say(text = ""): void {
  process.stderr.write(`${text}\n`);
}

export async function ask(question: string): Promise<string> {
  return (await rl.question(`${question} `)).trim();
}

export async function askUntil(question: string, valid: (v: string) => boolean): Promise<string> {
  for (;;) {
    const answer = await ask(question);
    if (valid(answer)) return answer;
    say("  Invalid value, try again.");
  }
}

export async function pressEnter(prompt = "Press Enter when done..."): Promise<void> {
  await rl.question(`${prompt} `);
}
