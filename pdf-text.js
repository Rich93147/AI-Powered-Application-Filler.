/* Offline text-layer extraction from PDF content streams; not OCR. */
(function (root) {
  const decode = bytes => new TextDecoder('latin1').decode(bytes);
  const unescapeText = raw => raw.replace(/\\([0-7]{1,3}|[nrtbf()\\]|\r?\n)/g, (m, c) => {
    if (/^[0-7]/.test(c)) return String.fromCharCode(parseInt(c, 8));
    return {n:'\n',r:'\r',t:'\t',b:'\b',f:'\f','(': '(',')':')','\\':'\\'}[c] ?? '';
  });
  function strings(contents) {
    const fragments=[];
    for(const block of (contents.match(/BT\b[\s\S]*?\bET/g)||[])) {
      const operations=/\[([\s\S]*?)\]\s*TJ|\(((?:\\.|[^\\)])*)\)\s*Tj|<([0-9A-Fa-f\s]+)>\s*Tj/g;
      let m;
      while((m=operations.exec(block))) {
        if(m[1]) {
          const parts=[...m[1].matchAll(/\(((?:\\.|[^\\)])*)\)|<([0-9A-Fa-f\s]+)>/g)];
          const t=parts.map(x=>x[1]!==undefined?unescapeText(x[1]):hexString(x[2])).join('');
          if(t.trim()) fragments.push(t);
        } else if(m[2]!==undefined) fragments.push(unescapeText(m[2]));
        else if(m[3]) fragments.push(hexString(m[3]));
      }
    }
    return fragments.join(' ').replace(/\s+/g,' ').trim();
  }
  function hexString(value) {
    const hex=value.replace(/\s/g,''); let bytes=[];
    for(let i=0;i<hex.length;i+=2) bytes.push(parseInt(hex.slice(i,i+2).padEnd(2,'0'),16));
    if(bytes[0]===254&&bytes[1]===255) {let out='';for(let i=2;i+1<bytes.length;i+=2)out+=String.fromCharCode(bytes[i]*256+bytes[i+1]);return out;}
    return decode(new Uint8Array(bytes));
  }
  function ascii85(encoded) {
    let chars=encoded.trim().replace(/^<~/,'').replace(/~>[\s\S]*$/,'').replace(/\s+/g,'');
    const out=[];let group=[];
    for(const ch of chars) {
      if(ch==='z' && !group.length){out.push(0,0,0,0);continue;}
      const v=ch.charCodeAt(0);if(v<33||v>117)continue;
      group.push(v-33);
      if(group.length===5){let n=0;for(const x of group)n=n*85+x;out.push((n>>>24)&255,(n>>>16)&255,(n>>>8)&255,n&255);group=[];}
    }
    if(group.length){const length=group.length;while(group.length<5)group.push(84);
      let n=0;for(const x of group)n=n*85+x;
      const bytes=[(n>>>24)&255,(n>>>16)&255,(n>>>8)&255,n&255];out.push(...bytes.slice(0,length-1));}
    return new Uint8Array(out);
  }
  async function extract(file) {
    const bytes=new Uint8Array(await file.arrayBuffer());
    if(!decode(bytes.slice(0,8)).startsWith('%PDF-')) throw new Error('Not a PDF file.');
    const raw=decode(bytes), result=[]; const re=/stream\r?\n/g; let match;
    while((match=re.exec(raw))) {
      if(raw.slice(Math.max(0,match.index-3),match.index)==='end')continue;
      const end=raw.indexOf('endstream',re.lastIndex); if(end<0) break;
      const dict=raw.slice(Math.max(0,match.index-1000),match.index);
      if(/\/Subtype\s*\/Image\b/.test(dict)) {re.lastIndex=end+9; continue;}
      const tail = bytes[end-1]===10?(bytes[end-2]===13?2:1):0;
      let slice=bytes.slice(re.lastIndex,end-tail);
      if(/\/ASCII85Decode\b/.test(dict))slice=ascii85(decode(slice));
      try {
        let plain;
        if(/\/FlateDecode\b/.test(dict)) {
          const decompressed=new Blob([slice]).stream().pipeThrough(new DecompressionStream('deflate'));
          plain=decode(new Uint8Array(await new Response(decompressed).arrayBuffer()));
        } else if(/\/Filter\s*\//.test(dict)) {re.lastIndex=end+9;continue;}
        else plain=decode(slice);
        const text=strings(plain);if(text)result.push(text);
      } catch { /* unsupported font or compression: keep scanning */ }
      re.lastIndex=end+9;
    }
    const text=result.join('\n').trim();
    if(text.length<20) throw new Error('No readable PDF text layer. Image/scanned PDFs and some custom font encodings are unsupported; paste text instead.');
    return text;
  }
  root.ApplicationFillerPDF={extract};
})(globalThis);
