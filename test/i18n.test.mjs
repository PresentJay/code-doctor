import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {messages} from '../web/messages.mjs';
import {locales,resolveLocale,createTranslator,translateDocument} from '../web/i18n.mjs';

test('English fallback and all supported locales have complete, compatible messages', async () => {
  assert.equal(resolveLocale(), 'en'); assert.equal(resolveLocale('unknown'),'en');
  assert.equal(resolveLocale('ja-JP'),'ja'); assert.equal(resolveLocale('ko-KR'),'ko'); assert.equal(resolveLocale('zh-Hans'),'zh-CN');
  const keys=Object.keys(messages.en).sort();
  const slots=text=>[...text.matchAll(/\{\d+\}/g)].map(match=>match[0]).sort();
  for(const locale of locales){
    assert.deepEqual(Object.keys(messages[locale]).sort(),keys);
    for(const key of keys){assert.ok(messages[locale][key].trim());assert.deepEqual(slots(messages[locale][key]),slots(key),`${locale}: ${key}`);}
    const original='<img onerror=bad> 日本語 中文 한국어 {0}';
    assert.ok(createTranslator(locale)('Added: {0}',original).includes(original));
  }
  const app=await readFile(new URL('../web/app.mjs',import.meta.url),'utf8');
  for(const match of app.matchAll(/msg\(("(?:\\.|[^"\\])*")/g))assert.ok(Object.hasOwn(messages.en,JSON.parse(match[1])),match[1]);
  const html=await readFile(new URL('../web/index.html',import.meta.url),'utf8');
  assert.match(html,/<html lang="en">/);
  assert.match(html,/id="language"/);
  for(const match of html.matchAll(/data-i18n(?:-[a-z-]+)?="([^"]+)"/g))assert.ok(Object.hasOwn(messages.en,match[1].replaceAll('&quot;','"').replaceAll('&amp;','&')));
});

test('translated labels use text and attributes without translating user-authored content',()=>{
  const label={textContent:'English',getAttribute:()=> 'Save opinion'};
  const field={value:'Original user text 日本語 中文 한국어',getAttribute:()=> 'Example: return an error here and keep the existing response format.',setAttribute(name,value){this[name]=value;}};
  const document={documentElement:{lang:'en'},querySelectorAll(selector){return selector==='[data-i18n]'?[label]:selector==='[data-i18n-placeholder]'?[field]:[];}};
  translateDocument(document,'ja');
  assert.equal(document.documentElement.lang,'ja');assert.equal(label.textContent,'意見を保存');
  assert.equal(field.placeholder,messages.ja['Example: return an error here and keep the existing response format.']);
  assert.equal(field.value,'Original user text 日本語 中文 한국어');
});
