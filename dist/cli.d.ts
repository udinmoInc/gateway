#!/usr/bin/env node
interface ParsedArgs {
    values: Record<string, string | boolean | (string | boolean)[] | undefined>;
    positionals: string[];
}
declare function parseCliArgs(argv: string[]): ParsedArgs;
declare function cmdStart(values: ParsedArgs['values']): Promise<void>;
declare function cmdInit(dir?: string): Promise<void>;
declare function cmdDoctor(configPath: string | undefined): Promise<void>;
declare function main(): Promise<void>;

export { type ParsedArgs, cmdDoctor, cmdInit, cmdStart, main, parseCliArgs };
