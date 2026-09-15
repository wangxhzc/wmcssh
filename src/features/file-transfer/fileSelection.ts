export type FileSelection = { paths: string[]; anchor?: string; focus?: string; directory?: string };

export function selectFile(
  selection: FileSelection,
  order: string[],
  path: string,
  modifiers: { range?: boolean; toggle?: boolean } = {}
): FileSelection {
  if (!order.includes(path)) return selection;
  const anchor = selection.anchor && order.includes(selection.anchor) ? selection.anchor : path;
  if (modifiers.range) {
    const start = order.indexOf(anchor);
    const end = order.indexOf(path);
    const range = order.slice(Math.min(start, end), Math.max(start, end) + 1);
    return { ...selection, paths: modifiers.toggle ? [...new Set([...selection.paths, ...range])] : range, anchor, focus: path };
  }
  const paths = modifiers.toggle
    ? selection.paths.includes(path) ? selection.paths.filter((item) => item !== path) : [...selection.paths, path]
    : [path];
  return { ...selection, paths, anchor: path, focus: path };
}

export function reconcileSelection(selection: FileSelection, directory: string, order: string[]): FileSelection {
  if (selection.directory !== directory) return { paths: [], directory };
  return {
    directory,
    paths: selection.paths.filter((path) => order.includes(path)),
    anchor: order.includes(selection.anchor ?? "") ? selection.anchor : undefined,
    focus: order.includes(selection.focus ?? "") ? selection.focus : undefined
  };
}
