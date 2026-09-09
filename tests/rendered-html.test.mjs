import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);
  return worker.fetch(
    new Request("http://localhost/", { headers: { accept: "text/html" } }),
    { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
    { waitUntil() {}, passThroughOnException() {} },
  );
}

test("root sends the learner to the mobile application", async () => {
  const response = await render();
  assert.ok([307, 308].includes(response.status));
  assert.equal(new URL(response.headers.get("location"), "http://localhost").pathname, "/mobile.html");
});

test("mobile build contains the complete vocabulary-learning path", async () => {
  const [markup, bridge, serviceWorker, manifest, apiRoute, learning, support, account] = await Promise.all([
    readFile(new URL("../public/mobile.html", import.meta.url), "utf8"),
    readFile(new URL("../public/mobile-bridge.js", import.meta.url), "utf8"),
    readFile(new URL("../public/sw.js", import.meta.url), "utf8"),
    readFile(new URL("../public/manifest.webmanifest", import.meta.url), "utf8"),
    readFile(new URL("../app/api/deepseek/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../public/learning.js", import.meta.url), "utf8"),
    readFile(new URL("../public/learning-support.js", import.meta.url), "utf8"),
    readFile(new URL("../public/cloud-account.js", import.meta.url), "utf8"),
  ]);
  const html = markup + learning + support;

  for (const id of [
    "article", "readAll", "analyzeArticle", "toggleTranslation", "wordList",
    "startStudy", "wordbookList", "startReview", "grammarList", "archiveList", "teacherQuestion", "askSentenceGrammar", "openSetup",
  ]) assert.match(html, new RegExp(`id=["']${id}["']`));

  assert.match(html, /const GRAMMAR_TOPICS=\[/);
  assert.match(html, /Math\.min\(10,/);
  assert.match(html, /if\(n===3\)buildWordTest\(\)/);
  assert.match(html, /function reviewDueWords\(\)/);
  assert.match(html, /intervals=\[1,3,7,14,30,60\]/);
  assert.match(html, /state\.testOutcome=ok/);
  assert.match(html, /selectedContexts/);
  assert.match(html, /function locationFor\(word\)/);
  assert.match(html, /selected_contexts:contexts/);
  assert.match(html, /sentence\.speaking/);
  assert.match(html, /sentenceStart/);
  assert.match(html, /MAX_ARTICLE_WORDS=1200/);
  assert.match(html, /原文不截断/);
  assert.match(html, /\$\('nextStep'\)\.disabled=true/);
  assert.match(html, /className='parallel-row'/);
  assert.match(bridge, /verifyResult\(operation/);
  assert.match(bridge, /CapacitorHttp/);
  assert.match(bridge, /focus_sentence/);
  assert.match(bridge, /evidence_quote/);
  assert.match(bridge, /maxTokens: 10000/);
  assert.match(bridge, /词单中有词不在当前原文里/);
  assert.match(bridge, /context_evidence/);
  assert.match(apiRoute, /selected_contexts/);
  assert.match(apiRoute, /context_evidence/);
  assert.match(apiRoute, /grammar_reference/);
  assert.match(apiRoute, /verifyArticle\(result/);
  assert.match(apiRoute, /verifyWords\(result/);
  assert.match(html, /ARTICLE_ARCHIVE_KEY/);
  assert.match(html, /articleArchive\[articleId\(ps\)\]/);
  assert.match(apiRoute, /structure_confidence/);
  assert.match(apiRoute, /sentence\.sentence_index/);
  assert.match(serviceWorker, /single-point-v11/);
  assert.match(markup, /cloud-account\.js/);
  assert.match(account, /api\/auth\/\$\{mode\}/);
  assert.match(account, /api\/sync/);
  assert.equal(JSON.parse(manifest).display, "standalone");

  const inline = [...html.matchAll(/<script(?: [^>]*)?>([\s\S]*?)<\/script>/g)]
    .map(match => match[1]).filter(code => code.trim());
  inline.forEach(code => new Function(code));
  new Function(bridge);
  new Function(learning);
  new Function(support);
  new Function(account);
});
