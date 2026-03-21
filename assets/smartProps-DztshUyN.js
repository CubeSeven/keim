import{d as i,b as u,w,V as d}from"./index-BB4Ym7Sq.js";function y(t){const a={meta:{},body:t},e=t.match(/^---\n([\s\S]*?)\n---(?:\n|$)([\s\S]*)$/);if(!e)return a;const n=e[1],s=e[2],r={};for(const c of n.split(`
`)){const o=c.indexOf(":");if(o===-1)continue;const m=c.slice(0,o).trim(),l=c.slice(o+1).trim();m&&(r[m]=l)}return{meta:r,body:s}}function S(t,a){return Object.keys(t).length===0?a:`---
${Object.entries(t).map(([n,s])=>`${n}: ${s}`).join(`
`)}
---
${a}`}function h(t){return t?`${t}/.keim-schema.json`:".keim-schema.json"}async function p(t){return await i.smartSchemas.where({folderId:t}).first()??null}async function v(t,a,e){const n=await i.smartSchemas.where({folderId:t}).first();if(n?.id!==void 0?await i.smartSchemas.update(n.id,{fields:a}):await i.smartSchemas.add({folderId:t,fields:a}),await i.items.update(t,{updated_at:Date.now()}),u()==="vault"&&e!==void 0)try{const s=JSON.stringify({version:1,fields:a},null,2);await w(h(e),s)}catch(s){console.warn("smartProps: could not write sidecar to vault",s)}}async function $(t,a){if(await i.smartSchemas.where({folderId:t}).delete(),u()==="vault"&&a!==void 0)try{await d(h(a))}catch{}}export{$ as d,y as p,p as r,S as s,v as w};
