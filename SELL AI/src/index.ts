import * as path from 'path';
import { CLI } from './cli/cli';
import { loadConfig } from './config/config';
import { createServices } from './runtime';
import { startServer } from './server/http-server';

async function main(): Promise<void> {
  const baseDir = path.resolve(__dirname, '..');
  const config = loadConfig(baseDir);
  const args = process.argv.slice(2);

  if (args.includes('--server')) config.mode = 'server';
  if (args.includes('--local')) config.mode = 'local';

  if (config.mode === 'server') {
    startServer(config, baseDir);
    return;
  }

  const services = createServices(config, baseDir);
  await services.core.initialize();

  const cli = new CLI(services.deps, services.core);
  const commandArgs = args.filter((a) => a !== '--local' && a !== '--server');
  if (commandArgs.length > 0) {
    await cli.runOnce(commandArgs);
    return;
  }
  cli.runInteractive();
}

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  process.stderr.write(`Критична помилка SELL AI: ${message}\n`);
  process.exit(1);
});