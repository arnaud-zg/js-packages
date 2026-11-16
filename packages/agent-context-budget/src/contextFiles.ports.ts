export interface ContextFiles {
  read(path: string): string | null;
  exists(path: string): boolean;
  claudeMdUnder(dirs: string[]): string[];
  markdownIn(dir: string): string[];
}
