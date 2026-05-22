export function unifiedDiff(oldText, newText, from = 'before', to = 'after') {
  if (oldText === newText) {
    return '';
  }
  const oldLines = String(oldText || '').split('\n');
  const newLines = String(newText || '').split('\n');
  const rows = [`--- ${from}`, `+++ ${to}`];
  const operations = diffLines(oldLines, newLines);
  for (const operation of operations) {
    if (operation.type === 'same') {
      rows.push(` ${operation.value}`);
    } else if (operation.type === 'remove') {
      rows.push(`-${operation.value}`);
    } else {
      rows.push(`+${operation.value}`);
    }
  }
  return rows.join('\n');
}

function diffLines(oldLines, newLines) {
  const table = Array.from({ length: oldLines.length + 1 }, () => Array(newLines.length + 1).fill(0));
  for (let oldIndex = oldLines.length - 1; oldIndex >= 0; oldIndex -= 1) {
    for (let newIndex = newLines.length - 1; newIndex >= 0; newIndex -= 1) {
      if (oldLines[oldIndex] === newLines[newIndex]) {
        table[oldIndex][newIndex] = table[oldIndex + 1][newIndex + 1] + 1;
      } else {
        table[oldIndex][newIndex] = Math.max(table[oldIndex + 1][newIndex], table[oldIndex][newIndex + 1]);
      }
    }
  }

  const operations = [];
  let oldIndex = 0;
  let newIndex = 0;
  while (oldIndex < oldLines.length && newIndex < newLines.length) {
    if (oldLines[oldIndex] === newLines[newIndex]) {
      operations.push({ type: 'same', value: oldLines[oldIndex] });
      oldIndex += 1;
      newIndex += 1;
    } else if (table[oldIndex + 1][newIndex] >= table[oldIndex][newIndex + 1]) {
      operations.push({ type: 'remove', value: oldLines[oldIndex] });
      oldIndex += 1;
    } else {
      operations.push({ type: 'add', value: newLines[newIndex] });
      newIndex += 1;
    }
  }

  while (oldIndex < oldLines.length) {
    operations.push({ type: 'remove', value: oldLines[oldIndex] });
    oldIndex += 1;
  }
  while (newIndex < newLines.length) {
    operations.push({ type: 'add', value: newLines[newIndex] });
    newIndex += 1;
  }

  return operations;
}
