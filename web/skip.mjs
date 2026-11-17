const params = new URLSearchParams(location.hash.slice(1));
const language = params.get('lang');
const messages = {
  en:['Continuing without review. Return to your agent.','Could not end the wait. If the review is open, finish there to keep your drafts.'],
  ko:['검토를 미뤘습니다. 작업 대화로 돌아가세요.','대기를 끝내지 못했습니다. 검토 화면이 열려 있다면 작성한 의견을 확인하고 그곳에서 마쳐 주세요.'],
  ja:['レビューを後回しにしました。作業中の会話に戻ってください。','待機を終了できませんでした。レビュー画面が開いている場合は、下書きを確認してそちらで終了してください。'],
  'zh-CN':['已暂时跳过审阅，请返回工作对话。','无法结束等待。如果审阅页面已打开，请检查草稿并在那里结束。'],
};
const text = messages[language] ?? messages.en;
document.documentElement.lang = Object.hasOwn(messages,language) ? language : 'en';
try {
  const response = await fetch('/api/skip', {method:'POST',headers:{'Content-Type':'application/json','X-Code-Doctor-Token':params.get('token') ?? ''},body:JSON.stringify({waitId:params.get('waitId') ?? ''})});
  if (!response.ok) throw new Error('Skip failed');
  document.getElementById('status').textContent = text[0];
} catch { document.getElementById('status').textContent = text[1]; }
