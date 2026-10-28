// Shared by the capture core and browser: excerpts only come from captured patch lines.
export const patchLineCount = patch => patch ? patch.split('\n').length - Number(patch.endsWith('\n')) : 0;

export function patchRows(patch, includeMetadata = false) {
  const rows = [];
  let oldLine, newLine, oldEnd, newEnd;
  const lines = patch.split('\n');
  if (lines.at(-1) === '') lines.pop();
  for (const line of lines) {
    const hunk = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(line);
    if (hunk) {
      oldLine = Number(hunk[1]); newLine = Number(hunk[3]);
      oldEnd = oldLine + Number(hunk[2] ?? 1); newEnd = newLine + Number(hunk[4] ?? 1);
      if (includeMetadata) rows.push({oldLine:null,newLine:null,type:'hunk',text:line});
    }
    // Git may omit the space prefix on empty context; hunk bounds exclude trailing separators.
    else if (oldLine < oldEnd && newLine < newEnd && (line.startsWith(' ') || line === '')) rows.push({oldLine:oldLine++,newLine:newLine++,type:'context',text:line.slice(1)});
    else if (oldLine < oldEnd && line.startsWith('-')) rows.push({oldLine:oldLine++,newLine:null,type:'deletion',text:line.slice(1)});
    else if (newLine < newEnd && line.startsWith('+')) rows.push({oldLine:null,newLine:newLine++,type:'addition',text:line.slice(1)});
    else if (includeMetadata) rows.push({oldLine:null,newLine:null,type:oldLine === undefined ? 'metadata' : 'diff-note',text:line});
  }
  return rows;
}

export function focusExcerpts(units, block) {
  if (block.focus === undefined) return [];
  if (!Array.isArray(block.focus) || !block.focus.length || block.focus.length > 3) throw new Error('focus must contain 1 to 3 code ranges.');
  let total = 0;
  const selected = new Map();
  const parsed = new Map();
  return block.focus.map(range => {
    const keys = ['unitId','side','startLine','endLine'];
    if (!range || typeof range !== 'object' || Object.keys(range).length !== keys.length || !keys.every(key => Object.hasOwn(range,key)) || !['old','new'].includes(range.side) || !Number.isSafeInteger(range.startLine) || !Number.isSafeInteger(range.endLine) || range.startLine < 1 || range.endLine < range.startLine) throw new Error('Invalid focus range. Use unitId, side old/new and positive startLine/endLine.');
    const count = range.endLine - range.startLine + 1;
    total += count;
    if (count > 40 || total > 80) throw new Error('Focus is limited to 40 lines per range and 80 lines per block.');
    const unit = units.find(item => item.id === range.unitId);
    if (!unit || !block.unitIds.includes(unit.id) || unit.binary) throw new Error('Focus must reference a text unit assigned to this block.');
    const key = `${unit.id}:${range.side}`;
    const previous = selected.get(key) ?? [];
    if (previous.some(item => range.startLine <= item.endLine && range.endLine >= item.startLine)) throw new Error('Focus ranges on the same side must not overlap.');
    selected.set(key,[...previous,range]);
    if (!parsed.has(unit.id)) parsed.set(unit.id,patchRows(unit.patch));
    const field = `${range.side}Line`;
    const rows = parsed.get(unit.id).filter(row => row[field] !== null && row[field] >= range.startLine && row[field] <= range.endLine);
    if (rows.length !== count || rows.some((row,index) => row[field] !== range.startLine + index)) throw new Error('Focus lines must exist contiguously in the captured patch.');
    if (!rows.some(row => row.type === (range.side === 'old' ? 'deletion' : 'addition'))) throw new Error('Focus must include a changed line on the selected side.');
    return {...range,file:range.side === 'old' ? unit.previousFile ?? unit.file : unit.file,stage:unit.stage,rows};
  });
}

export function blockContent(review, block, view = 'focus') {
  const units = block ? block.unitIds.map(id => review.units.find(unit => unit.id === id)) : [];
  const excerpts = block ? focusExcerpts(units,block) : [];
  const focused = view === 'focus' && excerpts.length > 0;
  const fullPatchLines = units.reduce((sum,unit)=>sum + patchLineCount(unit.patch),0);
  const coverage = {changedLines:0,shownChangedLines:0,unshown:[],nonLineUnitIds:[]};
  for (const unit of units) {
    const changes = patchRows(unit.patch).filter(row=>row.type !== 'context');
    if (!changes.length || unit.previousFile || (unit.oldMode !== '000000' && unit.newMode !== '000000' && unit.oldMode !== unit.newMode)) coverage.nonLineUnitIds.push(unit.id);
    for (const row of changes) {
      const side = row.type === 'deletion' ? 'old' : 'new';
      const line = row[`${side}Line`];
      coverage.changedLines++;
      if (!focused || excerpts.some(range=>range.unitId === unit.id && range.side === side && line >= range.startLine && line <= range.endLine)) {
        coverage.shownChangedLines++;
      } else {
        const previous = coverage.unshown.at(-1);
        if (previous?.unitId === unit.id && previous.side === side && previous.endLine + 1 === line) previous.endLine = line;
        else coverage.unshown.push({unitId:unit.id,file:side === 'old' ? unit.previousFile ?? unit.file : unit.file,stage:unit.stage,side,startLine:line,endLine:line});
      }
    }
  }
  return {units:focused ? units.map(({patch,...unit})=>unit) : units, excerpts:focused ? excerpts : [], view:focused ? 'focus' : 'full',
    coverage,
    sourceStats:{unitCount:units.length,fullPatchLines,visibleLines:focused ? excerpts.reduce((sum,item)=>sum + item.rows.length,0) : fullPatchLines}};
}
