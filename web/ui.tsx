import * as React from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { Button } from './components/button';
import { Textarea } from './components/textarea';

for (const node of document.querySelectorAll<HTMLElement>('[data-shadcn]')) {
  const mount = document.createElement('span');
  mount.style.display = 'contents';
  const props: Record<string, unknown> = {};
  for (const attr of node.attributes) {
    if (attr.name === 'data-shadcn') continue;
    const key = ({class:'className', maxlength:'maxLength', readonly:'readOnly'} as Record<string,string>)[attr.name] ?? attr.name;
    props[key] = ['disabled','hidden','readonly'].includes(attr.name) ? true : attr.value;
  }
  const component = node.dataset.shadcn === 'textarea'
    ? <Textarea {...props} />
    : <Button {...props} variant={node.dataset.shadcn as 'default' | 'outline'}>{node.textContent}</Button>;
  node.replaceWith(mount);
  flushSync(() => createRoot(mount).render(component));
}
const inventory = document.getElementById('inventory') as HTMLDetailsElement | null;
if (inventory && window.matchMedia('(max-width: 720px)').matches) inventory.open = false;
await import('/app.mjs');
