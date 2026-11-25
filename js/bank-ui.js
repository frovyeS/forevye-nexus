/* FOREVYE NEXUS Banka: sunucu bakiyesi, kristal cüzdanı, başarımlar ve işlem ayrıntıları. */
(function (root) {
  'use strict';
  const C = root.FNXConnect, $ = (s, r = document) => r.querySelector(s);
  let me = null, route = 'home', cache = {};
  const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const money = n => (Number(n || 0) / 100).toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const crystal = n => Number(n || 0).toLocaleString('tr-TR', { maximumFractionDigits: 4 });
  const date = n => n ? new Date(Number(n)).toLocaleString('tr-TR', { dateStyle: 'medium', timeStyle: 'short' }) : '—';
  const req = (m, p, b) => C.bankRequest(m, p, b);
  function shell() {
    document.body.classList.add('in-bank');
    $('#view-gate').hidden = true; $('#view-editor').hidden = true; $('#view-app').hidden = false;
    document.body.classList.remove('in-editor');
    const nav = [['home','Ana sayfa'],['wallet','Kristal cüzdanı'],['activity','Hareketler'],['achievements','Başarımlar'],['notifications','Bildirimler'],['market','Market']];
    $('#page').innerHTML = `<header class="page-h"><h1>FOREVYE NEXUS</h1><p class="muted">Sanal banka ve koleksiyon ekonomisi</p></header><nav class="bank-nav">${nav.map(([k,t])=>`<button type="button" data-bank-route="${k}" class="btn ${route===k?'primary':''}">${t}</button>`).join('')}</nav><div id="bank-content" aria-live="polite"></div><div id="bank-modal" class="bank-modal" hidden role="dialog" aria-modal="true"><div class="bank-modal-card"><button type="button" class="btn sm" data-close-modal>Kapat</button><div id="bank-modal-content"></div></div></div>`;
    $('#page').onclick = onClick;
    paint();
  }
  async function paint() {
    const box = $('#bank-content'); if (!box) return;
    box.innerHTML = '<section class="panel"><p>Bilgiler güvenli sunucudan yükleniyor…</p></section>';
    try {
      if (route === 'home') {
        const [w,m,tx] = await Promise.all([req('GET','/api/wallet'), req('GET','/api/market'), req('GET','/api/transactions?limit=5')]);
        cache.home={w,m,tx};
        box.innerHTML = `<div class="bank-grid"><section class="panel bank-balance" data-bank-route="activity" role="button" tabindex="0"><span class="muted">Sanal bakiye · hareketleri aç</span><div class="bank-big">${money(w.balance)} <small>FN</small></div><span class="note">Oyun içi sanal bakiye</span></section><section class="panel crystal-panel"><span class="muted">Kristal cüzdanı</span><div class="bank-big crystal-text">◇ ${crystal(m.you?.qty/(m.qty_scale||10000))} <small>KRS</small></div><span class="note">Anlık kristal varlığın</span><button class="btn primary" data-bank-route="wallet">Cüzdanı aç</button></section></div><section class="panel"><div class="row between"><h2 class="panel-h">Son hareketler</h2><button class="btn sm" data-bank-route="activity">Tümünü gör</button></div>${tx.items.length?`<ul class="bank-list">${tx.items.map(txRow).join('')}</ul>`:'<p class="muted">Henüz hareket yok.</p>'}</section><section class="panel"><h2 class="panel-h">Kısayollar</h2><div class="row wrap"><button class="btn" data-bank-route="market">Nexus Market’e git</button><button class="btn" data-bank-route="achievements">Başarımlarım</button><button class="btn" data-bank-route="notifications">Bildirimler</button></div></section>`;
      } else if (route === 'wallet') {
        const [m,tr] = await Promise.all([req('GET','/api/market'),req('GET','/api/market/trades?limit=20')]); cache.wallet={m,tr};
        const q=m.you?.qty/(m.qty_scale||10000), val=m.you?.value_minor||0, pnl=m.you?.pnl_minor||0;
        box.innerHTML=`<section class="panel crystal-panel"><span class="muted">Toplam kristal</span><div class="bank-big crystal-text">◇ ${crystal(q)} <small>KRS</small></div><div class="bank-stats"><div><small>Güncel değer</small><b>${money(val)} FN</b></div><div><small>Alış maliyeti</small><b>${money(m.you?.cost_minor)} FN</b></div><div><small>Değişim</small><b class="${pnl>=0?'pos':'neg'}">${pnl>=0?'+':''}${money(pnl)} FN</b></div></div><p class="note">Kristal oyun içi dijital varlıktır; gerçek para veya mevduat değildir.</p><button class="btn primary" data-market-open>Kristal borsasını aç</button></section><section class="panel"><h2 class="panel-h">Kristal işlemleri</h2>${tr.items.length?`<ul class="bank-list">${tr.items.map(t=>`<li data-crystal-detail="${esc(t.ref)}"><span><b>${t.side==='buy'?'Kristal alımı':'Kristal satışı'}</b><small>${date(t.created_at)} · Ref: ${esc(t.ref)}</small></span><strong>${t.side==='buy'?'+':'−'}${crystal(Number(t.qty)/(m.qty_scale||10000))} KRS</strong></li>`).join('')}</ul>`:'<p class="muted">Henüz kristal işlemin yok.</p>'}</section>`;
      } else if (route === 'activity') {
        const d=await req('GET','/api/transactions?limit=50'); cache.activity=d;
        box.innerHTML=`<section class="panel"><h2 class="panel-h">Bakiye hareketleri</h2>${d.items.length?`<ul class="bank-list">${d.items.map(txRow).join('')}</ul>`:'<p class="muted">Henüz işlem yok.</p>'}</section>`;
      } else if (route === 'achievements') {
        const d=await req('GET','/api/vault'); cache.achievements=d;
        box.innerHTML=`<section class="panel"><h2 class="panel-h">Başarımlar</h2><p class="muted">Görevleri tamamla, rozetleri ve kristal ödüllerini kazan.</p><div class="achievement-grid">${d.badges.map(a=>`<article class="achievement ${a.earned_at?'earned':'locked'}"><div class="achievement-icon">${a.earned_at?'✦':'◇'}</div><b>${esc(a.title)}</b><p>${esc(a.desc)}</p>${a.reward?`<div class="reward-chip">◇ ${crystal(a.reward)} kristal</div>`:''}<small>${a.earned_at?'Kazanıldı · '+date(a.earned_at):'Henüz kazanılmadı'}</small></article>`).join('')}</div></section>`;
      } else if (route === 'notifications') {
        const d=await req('GET','/api/notifications'); cache.notifications=d;
        box.innerHTML=`<section class="panel"><div class="row between"><h2 class="panel-h">Bildirim merkezi</h2><button class="btn sm" data-read-all>Tümünü okundu işaretle</button></div>${d.items.length?`<ul class="bank-list">${d.items.map(n=>`<li class="notification-row ${n.read_at?'':'unread'}" data-notification="${esc(n.id)}"><span><b>${esc(n.title)}</b><small>${date(n.created_at)}</small><small>${esc(n.body)}</small></span><span>${n.read_at?'':'●'}</span></li>`).join('')}</ul>`:'<p class="muted">Yeni bildirimin yok.</p>'}</section>`;
      }
    } catch(e) { box.innerHTML=`<section class="panel"><h2>Bilgiler yüklenemedi</h2><p>${esc(e.message)}</p><button class="btn" data-reload>Tekrar dene</button></section>`; }
  }
  function txRow(x) { return `<li class="tx-click" data-tx="${esc(x.id)}"><span><b>${esc(x.description||x.type)}</b><small>${date(x.created_at)}${x.counterparty?' · '+esc(x.counterparty):''}</small></span><strong class="${x.amount<0?'neg':'pos'}">${x.amount<0?'−':'+'}${money(Math.abs(x.amount))} FN</strong></li>`; }
  function detail(title, html) { $('#bank-modal-content').innerHTML=`<h2>${esc(title)}</h2>${html}`; $('#bank-modal').hidden=false; }
  async function onClick(e) {
    const b=e.target.closest('[data-bank-route]'); if(b){const r=b.dataset.bankRoute;if(r==='market'){openMarket();return;}route=r;shell();return;}
    if(e.target.closest('[data-close-modal]')){$('#bank-modal').hidden=true;return;}
    if(e.target.closest('[data-reload]')){paint();return;}
    if(e.target.closest('[data-market-open]')){openMarket();return;}
    if(e.target.closest('[data-read-all]')){try{await req('POST','/api/notifications/read',{all:true});paint();}catch(err){root.FNXToast(err.message);}return;}
    const tr=e.target.closest('[data-tx]'); if(tr){const x=(cache.activity?.items||cache.home?.tx?.items||[]).find(z=>z.id===tr.dataset.tx);if(x)detail('İşlem ayrıntısı',`<dl class="bank-detail"><dt>İşlem</dt><dd>${esc(x.type)}</dd><dt>Tutar</dt><dd>${x.amount<0?'−':'+'}${money(Math.abs(x.amount))} FN</dd><dt>${x.amount>0?'Gönderen':'Alıcı / karşı taraf'}</dt><dd>${esc(x.counterparty||'—')}</dd><dt>Açıklama</dt><dd>${esc(x.description||'Açıklama eklenmemiş.')}</dd><dt>Durum</dt><dd>${esc(x.status||'success')}</dd><dt>Tarih</dt><dd>${date(x.created_at)}</dd><dt>Referans</dt><dd>${esc(x.tx_ref||'—')}</dd></dl>`);return;}
    const no=e.target.closest('[data-notification]');if(no){const n=(cache.notifications?.items||[]).find(z=>z.id===no.dataset.notification);if(n){if(!n.read_at)req('POST','/api/notifications/read',{ids:[n.id]}).catch(()=>{});const isTransfer = /^transfer_(sent|received)$/.test(n.type||'');
      const ref = (n.body||'').match(/Ref:\s*([A-Za-z0-9_-]+)/i);
      detail(n.title,`<section class="transfer-receipt"><div class="receipt-kicker">${isTransfer?'TRANSFER MAKBUZU':'BİLDİRİM AYRINTISI'}</div><p class="receipt-body">${esc(n.body||'Ayrıntı bulunmuyor.')}</p><dl class="bank-detail"><dt>İşlem türü</dt><dd>${isTransfer?(n.type==='transfer_sent'?'Gönderilen transfer':'Alınan transfer'):esc(n.type||'Bildirim')}</dd><dt>Bildirim zamanı</dt><dd>${date(n.created_at)}</dd>${ref?`<dt>İşlem referansı</dt><dd>${esc(ref[1])}</dd>`:''}<dt>Durum</dt><dd>Başarılı bildirim</dd></dl><p class="note">Bu makbuz, transfer sırasında kaydedilen tutar, karşı taraf, açıklama ve referans bilgisini gösterir.</p></section>`);}return;}
    const cd=e.target.closest('[data-crystal-detail]');if(cd){const t=(cache.wallet?.tr?.items||[]).find(z=>z.ref===cd.dataset.crystalDetail);if(t)detail(t.side==='buy'?'Kristal alım ayrıntısı':'Kristal satış ayrıntısı',`<dl class="bank-detail"><dt>Miktar</dt><dd>${crystal(Number(t.qty)/(cache.wallet.m.qty_scale||10000))} KRS</dd><dt>İşlem fiyatı</dt><dd>${money(t.price_micro/10000)} FN</dd><dt>Toplam</dt><dd>${money(t.total)} FN</dd><dt>Tarih</dt><dd>${date(t.created_at)}</dd><dt>Referans</dt><dd>${esc(t.ref)}</dd></dl>`);}
  }
  // Market AYRI bir site: eskiden aynı sekmede açılıyor, bankaya dönüş düğmesi olmadığı için kullanıcı bankadan kopuyordu.
  // Şimdi Market YENİ sekmede açılır; banka sekmesi olduğu gibi kalır (kapatınca/sekme değiştirince banka karşında).
  // Sekme, tıklamayla eşzamanlı açılır (aksi halde tarayıcı/telefon açılır pencereyi engeller); bilet gelince adrese yönlendirilir.
  let marketBusy = false;
  async function openMarket(){
    if (marketBusy) return; marketBusy = true;
    let w = null;
    try { w = root.open('', '_blank'); } catch (e) { w = null; }
    if (w) { try { w.document.title = 'Nexus Market'; w.document.body.style.cssText = 'margin:0;background:#07080B;color:#cfd3dc;font:16px system-ui;display:grid;place-items:center;height:100vh'; w.document.body.textContent = 'Nexus Market açılıyor…'; } catch (e) {} }
    try {
      const r = await req('POST','/api/bank/market-ticket',{});
      if (w && !w.closed) { w.location.href = r.url; root.FNXToast && root.FNXToast('Market yeni sekmede açıldı. Bankaya dönmek için bu sekmeye geç.'); }
      else root.location.href = r.url;   // açılır pencere engellendi: eski davranış (aynı sekme)
    } catch(e) {
      if (w) { try { w.close(); } catch (x) {} }
      root.FNXToast(e.message);
    } finally { marketBusy = false; }
  }
  function start(data){me=data.me;root.FNXBankUI={refresh:paint,request:req};shell();window.addEventListener('hashchange',()=>{});}
  root.FNXBankUI={start};
})(window);
