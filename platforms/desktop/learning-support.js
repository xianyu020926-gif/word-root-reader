// Shared across desktop, PWA and Android. No API credentials belong in backups.
const pendingRequests = {};
const blockedStorage = new Set();
function isPending(kind) { return pendingRequests[kind]?.origin === state; }
function beginRequest(kind) {
  const token = { origin: state };
  pendingRequests[kind] = token;
  updateRequestButtons();
  return token;
}
function finishRequest(kind, token) {
  if (pendingRequests[kind] === token) delete pendingRequests[kind];
  updateRequestButtons();
}
function updateRequestButtons() {
  $('analyzeArticle').disabled = isPending('analyze');
  $('analyzeArticle').textContent = isPending('analyze') ? '正在分析全文…' : 'AI 分析文章';
  $('askTeacher').disabled = isPending('teacher');
  $('askTeacher').textContent = isPending('teacher') ? '正在核对原文…' : '发送问题';
  $('enrichWords').disabled = !state.selected.length || isPending('enrich');
  $('enrichWords').textContent = isPending('enrich') ? '正在准备词卡…' : '单独准备 / 更新词卡';
}
function storageWarning(message) {
  const node = document.getElementById('storageWarning');
  node.hidden = false;
  node.textContent = message + ' 可在「文章档案」中导出备份。';
}
function writeLocal(key, value) {
  if (blockedStorage.has(key)) return false;
  try { localStorage.setItem(key, JSON.stringify(value)); return true; }
  catch (_) { storageWarning('设备存储失败，这次改动尚未保存；请勿关闭应用。'); return false; }
}
function record(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('记录格式无效');
  return value;
}
function strings(value, optional = false) {
  if (optional && value === undefined) return;
  if (!Array.isArray(value) || value.some(x => typeof x !== 'string')) throw new Error('文字列表格式无效');
}
function validateCard(card) {
  record(card);
  if (typeof card.meaning !== 'string' || !card.meaning.trim()) throw new Error('词卡缺少词义');
  for (const key of ['pieces','structure','etymology','coreMeaning','cardSentence']) {
    if (card[key] !== undefined && typeof card[key] !== 'string') throw new Error('词卡字段无效');
  }
  for (const key of ['morphology','family','contexts']) {
    if (card[key] !== undefined && (!Array.isArray(card[key]) || card[key].some(x => !x || typeof x !== 'object'))) throw new Error('词卡列表无效');
  }
}
function validateWordbook(value) {
  record(value);
  for (const [key, card] of Object.entries(value)) {
    validateCard(card);
    if (!/^[a-z]+(?:'[a-z]+)*$/.test(key) || card.word !== key) throw new Error('单词记录无效');
    for (const field of ['learnedCount','reviewCount','reviewStep']) {
      if (card[field] !== undefined && (!Number.isInteger(card[field]) || card[field] < 0)) throw new Error('学习次数无效');
    }
    for (const field of ['nextReviewAt','lastLearnedAt']) {
      if (card[field] && !Number.isFinite(Date.parse(card[field]))) throw new Error('复习日期无效');
    }
  }
  return value;
}
function validateArticle(value) {
  record(value);strings(value.paragraphs);
  if (!value.paragraphs.length || typeof value.title !== 'string') throw new Error('文章缺少标题或原文');
  const source = value.paragraphs.join('\n\n');
  if (source.length > MAX_ARTICLE_CHARS || wordsIn(source).length > MAX_ARTICLE_WORDS) throw new Error('备份中的文章超过单篇上限');
  for (const key of ['natural','literal','sentenceTranslations','selected','completedWords']) strings(value[key], true);
  for (const [key, card] of Object.entries(record(value.words || {}))) {
    if (!/^[a-z]+(?:'[a-z]+)*$/.test(key)) throw new Error('词卡名称无效');
    validateCard(card);
  }
  if ((value.selected || []).some(w => !wordsIn(source).includes(w))) throw new Error('词单含原文没有的词');
  if ((value.selected || []).length > 10 || new Set(value.selected || []).size !== (value.selected || []).length) throw new Error('词单数量或重复项无效');
  for (const loc of Object.values(record(value.selectedContexts || {}))) {
    if (!loc || !Number.isInteger(loc.paragraphIndex) || !Number.isInteger(loc.sentenceIndex) || !value.paragraphs[loc.paragraphIndex] || !sentencesIn(value.paragraphs[loc.paragraphIndex])[loc.sentenceIndex]) throw new Error('选词位置无效');
  }
  if (value.conversation !== undefined && (!Array.isArray(value.conversation) || value.conversation.some(x => !x || typeof x.question !== 'string' || typeof x.answer !== 'string'))) throw new Error('问答记录无效');
  for(const field of ['learningProgress','reviewProgress']) {
    const p=value[field];if(!p)continue;
    if(!/^[a-z]+(?:'[a-z]+)*$/.test(p.word||'') || !Number.isInteger(p.step) || p.step<0 || p.step>3 || !Array.isArray(p.queue) || p.queue.length>10 || p.queue.some(w=>typeof w!=='string'||!/^[a-z]+(?:'[a-z]+)*$/.test(w)) || !p.queue.includes(p.word)) throw new Error('学习断点格式无效');
  }
  return value;
}
function validateArchive(value) {
  record(value);
  for (const [id, article] of Object.entries(value)) {
    validateArticle(article);
    if (id !== article.id || id !== articleId(article.paragraphs)) throw new Error('文章标识不匹配');
  }
  return value;
}
function updateResume() {
  // Migrate the 0.13 checkpoint without losing an interrupted review.
  if(state.learningProgress?.reviewMode){state.reviewProgress=state.learningProgress;state.learningProgress=null;}
  const p = state.learningProgress;
  const valid = p && Number.isInteger(p.step) && p.step >= 0 && p.step <= 3 && (p.reviewMode ? wordbook[p.word] : state.selected.includes(p.word) && state.words[p.word]);
  $('resumePanel').hidden = !valid;
  if (valid) $('resumeLabel').textContent = `${p.reviewMode ? '复习' : '上次学到'} ${p.word} · ${['抓词','建结构','回扣段落','短暂找回'][p.step]}`;
  const review=state.reviewProgress;
  $('resumeReview').hidden=!(review && Object.hasOwn(wordbook,review.word) && Array.isArray(review.queue));
  if(!$('resumeReview').hidden)$('resumeReview').textContent='继续上次复习 · '+review.word;
}
function resumeLearning(review = false) {
  const p = review ? state.reviewProgress : state.learningProgress;
  if (!p) return;
  state.reviewMode = Boolean(p.reviewMode);
  state.reviewQueue = p.reviewMode && Array.isArray(p.queue) ? p.queue.filter(w => Object.hasOwn(wordbook,w)) : [];
  if (p.reviewMode ? !state.reviewQueue.includes(p.word) : !state.selected.includes(p.word) || !state.words[p.word]) return;
  const step = Math.max(0, Math.min(3, Number(p.step) || 0));
  openStudy(p.word);
  if (p.reviewMode) $('studyProgress').textContent = `继续复习 · ${p.word}`;
  setStep(step); // Never restore a revealed answer as a completed test.
}
function cardFitsSentence(word, sentence) {
  const card=state.words[word];
  if(!card)return false;
  return (card.cardSentence || sentenceFor(word)).trim() === sentence.trim();
}
function reliableParts(item) {
  return ['high','medium'].includes(item.structureConfidence) && Array.isArray(item.morphology) ? item.morphology : [];
}
function wordbookMatches(item, query) {
  if(!query)return true;
  const normalize=value=>String(value||'').toLowerCase().replace(/[-\s]/g,'');
  const parts=reliableParts(item);
  if(query.startsWith('#'))return parts.some(part=>part.type!=='base' && normalize(part.part)===normalize(query.slice(1)));
  const text=[item.word,item.meaning,item.coreMeaning,...parts.flatMap(part=>[part.part,part.meaning_zh])].join(' ').toLowerCase();
  return text.includes(query);
}
function startSingleReview(word) {
  if(!wordbook[word])return;
  if(state.reviewProgress && state.reviewProgress.word!==word && !confirm('开始巩固这个词会替换未完成的复习队列；文章的学习进度不会改变。继续吗？'))return;
  state.reviewMode=true;state.reviewQueue=[word];hideWordbook();openStudy(word);
  $('studyProgress').textContent='再次巩固 · '+word;setStep(3);
}
function wordbookDetails(item) {
  const details=document.createElement('details');details.className='book-details';
  const summary=document.createElement('summary');summary.textContent='词根与原句';details.append(summary);
  const parts=reliableParts(item);
  const structure=document.createElement('div');structure.className='book-structure';
  structure.textContent=parts.length?(parts.map(x=>x.part).join(' + ')+' · '+(item.structure||'')):'整体记忆 · '+item.word;
  details.append(structure);
  const roots=parts.filter(part=>part.type!=='base');
  if(roots.length){
    const links=document.createElement('div');links.className='root-links';
    for(const part of roots){
      const button=document.createElement('button');button.className='secondary root-link';
      const type={prefix:'前缀',root:'词根',suffix:'后缀'}[part.type]||'结构';
      button.textContent=part.part+' · '+(part.meaning_zh||type);button.title='在单词本里查找同一'+type;button.setAttribute('aria-label','查找同一'+type+' '+part.part);
      button.onclick=()=>{$('wordbookSearch').value='#'+part.part;renderWordbook('#'+part.part);$('wordbookSearch').focus()};links.append(button);
    }
    details.append(links);
    const note=document.createElement('div');note.className='book-meta';note.textContent='点结构标签，只查已学词中的同一结构。';details.append(note);
  }
  const contexts=Array.isArray(item.contexts)?item.contexts:[];
  if(!contexts.length){const note=document.createElement('p');note.className='book-meta';note.textContent='这条旧记录没有保存原句。';details.append(note)}
  for(const [index,context] of contexts.entries()){
    let host=details;
    if(index>0){host=document.createElement('details');const label=document.createElement('summary');label.textContent='另一处语境 · '+(context.title||'历史文章');host.append(label);details.append(host)}
    const quote=document.createElement('div');quote.className='book-context';
    const source=document.createElement('small');source.textContent=context.title||'来源文章';
    const en=document.createElement('p');en.textContent=context.sentence||'';
    const zh=document.createElement('div');zh.className='book-context-zh';zh.textContent=context.translation||'';
    const audio=document.createElement('button');audio.className='secondary';audio.textContent='听这句';audio.disabled=!context.sentence;audio.onclick=()=>speak(context.sentence);
    quote.append(source,en,zh,audio);host.append(quote);
  }
  const remove=document.createElement('button');remove.className='danger-soft book-remove';remove.textContent='删除这条学习记录';remove.onclick=()=>deleteBookWord(item.word);details.append(remove);
  return details;
}
function renderTeacherHistory() {
  const conversation = state.conversation || [];
  $('teacherResponse').textContent = conversation.at(-1)?.answer || '';
  const list = $('teacherHistory');list.replaceChildren();
  conversation.slice(0, -1).forEach(item => {
    const details = document.createElement('details');
    const question = document.createElement('summary');question.textContent = item.question;
    const answer = document.createElement('div');answer.className = 'teacher-response';answer.textContent = item.answer;
    details.append(question, answer);list.append(details);
  });
}
const inspectorAnchor = document.createComment('Right-hand word inspector');
document.getElementById('popover').before(inspectorAnchor);
function restoreInspector() { inspectorAnchor.after(document.getElementById('popover')); }
function placeInspector() {
  if (window.matchMedia('(max-width:900px)').matches && state.currentSentenceEl) {
    const translation = state.currentSentenceEl.nextElementSibling;
    if (translation?.classList.contains('sentence-translation')) translation.after($('popover'));
  } else restoreInspector();
}
window.matchMedia('(max-width:900px)').addEventListener('change', () => { if(state.current)placeInspector(); });
function backupPayload() {
  const data = { format: 'single-point-learning', version: 1, exportedAt: new Date().toISOString(), wordbook, articles: articleArchive, current: null };
  try { data.current = JSON.parse(localStorage.getItem(APP_STATE_KEY) || 'null'); } catch (_) {}
  // Use the current in-memory article if saving failed because the device is full.
  if (!blockedStorage.has(APP_STATE_KEY)) data.current = {
    title:state.title,paragraphs:state.paragraphs,natural:state.natural,literal:state.literal,
    sentenceTranslations:state.sentenceTranslations,words:state.words,translation:state.translation,
    selected:state.selected,selectedContexts:state.selectedContexts||{},conversation:state.conversation,
    articleAnalysis:state.articleAnalysis,learningProgress:state.learningProgress,reviewProgress:state.reviewProgress||null,completedWords:state.completedWords||[]
  };
  if (blockedStorage.size) {
    data.recovery = {};
    blockedStorage.forEach(key => { data.recovery[key] = localStorage.getItem(key); });
  }
  return data;
}
async function exportBackup() {
  try {
    const text = JSON.stringify(backupPayload(), null, 2);
    const filename = '单点穿透-学习备份-' + new Date().toISOString().slice(0,10) + '.json';
    const native = window.Capacitor?.isNativePlatform?.() && window.Capacitor?.Plugins?.NativeSpeech;
    if (native?.saveBackup) { await native.saveBackup({ text, filename }); }
    else if (window.wordApp?.saveBackup) { await window.wordApp.saveBackup({ text, filename }); }
    else {
      const url = URL.createObjectURL(new Blob([text], {type:'application/json'}));
      const a = document.createElement('a');a.href=url;a.download=filename;document.body.append(a);a.click();a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    }
    $('backupStatus').textContent = '备份保存操作已完成；请确认文件已保存在你选择的位置。备份不含 API Key。';
  } catch (error) { $('backupStatus').textContent = '导出未完成：' + error.message; }
}
function parseBackup(text) {
  if (text.length > 20 * 1024 * 1024) throw new Error('备份文件超过 20 MB');
  const data = JSON.parse(text, (key, value) => {
    if (key === '__proto__') throw new Error('备份含不安全字段');
    return value;
  });
  if (data.format !== 'single-point-learning' || data.version !== 1) throw new Error('不是支持的学习备份');
  validateWordbook(data.wordbook);validateArchive(data.articles);
  if (data.current) validateArticle(data.current);
  return data;
}
function mergeBackup(data) {
  // Validate the entire file before any mutation; choose the newer record on collisions.
  validateWordbook(data.wordbook);validateArchive(data.articles);if(data.current)validateArticle(data.current);
  const books = {...wordbook}, articles = {...articleArchive};
  if (data.current) {
    const currentId = articleId(data.current.paragraphs);
    const current = {...data.current,id:currentId,savedAt:data.exportedAt || new Date().toISOString()};
    if (!articles[currentId] || (current.savedAt || '') > (articles[currentId].savedAt || '')) articles[currentId] = current;
  }
  for (const [key, item] of Object.entries(data.wordbook)) {
    if (!books[key] || (item.lastLearnedAt || '') > (books[key].lastLearnedAt || '')) books[key] = item;
  }
  for (const [id, item] of Object.entries(data.articles)) {
    if (!articles[id] || (item.savedAt || '') > (articles[id].savedAt || '')) articles[id] = item;
  }
  const writes = [[WORD_BOOK_KEY,books],[ARTICLE_ARCHIVE_KEY,articles]];
  // Keep the current screen, unless it is an untouched demonstration on a fresh device.
  const restoreCurrent = !localStorage.getItem(APP_STATE_KEY) && data.current;
  if (restoreCurrent) writes.push([APP_STATE_KEY,data.current]);
  const old = writes.map(([key]) => [key,localStorage.getItem(key)]);
  let committed=0;
  try { for (const [key,value] of writes) { localStorage.setItem(key,JSON.stringify(value)); committed++; } }
  catch (error) {
    for (const [key,value] of old.slice(0,committed).reverse()) { try { if(value===null)localStorage.removeItem(key);else localStorage.setItem(key,value); } catch (_) { storageWarning('恢复失败且回滚未完成，请保留备份文件。'); } }
    throw new Error('设备空间不足，未完成恢复；请保留备份。');
  }
  wordbook=Object.assign(Object.create(null),books);articleArchive=articles;writes.forEach(([key])=>blockedStorage.delete(key));
  if(restoreCurrent){restoreProgress();render();renderTeacherHistory()}
  updateWordbookButton();renderArchive();updateResume();
  return {words:Object.keys(books).length,articles:Object.keys(articles).length};
}

// Small, shared additions to the existing layout; no overlay covers sentence translations.
{
  const warning=document.createElement('div');warning.id='storageWarning';warning.className='storage-warning';warning.hidden=true;warning.setAttribute('role','alert');document.querySelector('header').after(warning);
  const resume=document.createElement('div');resume.id='resumePanel';resume.className='resume-panel';resume.hidden=true;
  resume.innerHTML='<span id="resumeLabel"></span><button id="resumeStudy">继续上次</button>';
  document.querySelector('.article-head').append(resume);document.getElementById('resumeStudy').onclick=()=>resumeLearning();
  const resumeReview=document.createElement('button');resumeReview.id='resumeReview';resumeReview.className='secondary';resumeReview.hidden=true;resumeReview.onclick=()=>{hideWordbook();resumeLearning(true)};
  document.querySelector('.wordbook-tools').after(resumeReview);
  const tools=document.createElement('div');tools.className='backup-tools';
  tools.innerHTML='<div class="import-row"><button id="exportBackup" class="secondary">导出学习备份</button><button id="importBackup" class="secondary">恢复备份</button><input id="backupFile" type="file" accept=".json,application/json" hidden></div><p id="backupStatus">保存在当前设备；可通过备份转移到手机或平板，不会自动同步。不包含 API Key。</p>';
  document.querySelector('.archive-box .study-top').after(tools);
  document.getElementById('exportBackup').onclick=exportBackup;
  document.getElementById('importBackup').onclick=()=>document.getElementById('backupFile').click();
  document.getElementById('backupFile').onchange=async event=>{
    const file=event.target.files[0];event.target.value='';if(!file)return;
    try {
      if(file.size>20*1024*1024)throw new Error('备份文件超过 20 MB');
      const data=parseBackup(await file.text());
      if(!confirm(`恢复 ${Object.keys(data.articles).length} 篇文章和 ${Object.keys(data.wordbook).length} 个词？与本机记录合并，同一记录保留较新版本。`))return;
      const result=mergeBackup(data);document.getElementById('backupStatus').textContent=`恢复完成：本机共 ${result.articles} 篇文章、${result.words} 个词。`;
    }catch(error){document.getElementById('backupStatus').textContent='恢复失败：'+error.message}
  };
  const history=document.createElement('div');history.id='teacherHistory';document.querySelector('.teacher').append(history);
  const speed=document.createElement('select');speed.id='speechRate';speed.setAttribute('aria-label','朗读速度');
  speed.innerHTML='<option value="0.8">朗读 · 慢速</option><option value="0.95" selected>朗读 · 标准</option><option value="1.1">朗读 · 稍快</option>';
  document.getElementById('readAll').after(speed);
}
