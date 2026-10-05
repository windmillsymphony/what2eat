/* ============================================================
 * ui.js — 通用 UI：toast / confirm / modal / 星级 / chips 输入 /
 * 滑动手势 / 时间格式化
 * ============================================================ */
window.W2E = window.W2E || {};

(function () {
  'use strict';

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  /* ---------- Toast ---------- */

  function toast(msg, type) {
    const root = document.getElementById('toast-root');
    const el = document.createElement('div');
    el.className = 'toast' + (type ? ' ' + type : '');
    el.textContent = msg;
    root.appendChild(el);
    setTimeout(function () { el.classList.add('out'); }, 2200);
    setTimeout(function () { el.remove(); }, 2500);
  }

  /* ---------- Modal ---------- */

  function openModal(opts) {
    const root = document.getElementById('modal-root');
    const el = document.createElement('div');
    el.className = 'modal-overlay';
    el.innerHTML =
      '<div class="modal-card">' +
        '<div class="modal-head"><h3>' + esc(opts.title || '') + '</h3>' +
        '<button class="modal-x" aria-label="关闭">✕</button></div>' +
        '<div class="modal-body">' + (opts.bodyHTML || '') + '</div>' +
      '</div>';
    root.appendChild(el);

    const close = function () {
      el.remove();
    };
    el.querySelector('.modal-x').onclick = close;
    el.addEventListener('click', function (e) { if (e.target === el) close(); });

    const ret = { el: el, close: close };
    if (opts.onClose) el.addEventListener('modal-close', opts.onClose);
    return ret;
  }

  /* ---------- 确认框 ---------- */

  function confirm(opts) {
    return new Promise(function (resolve) {
      const msg = opts.messageHTML
        ? opts.messageHTML
        : '<p class="confirm-msg">' + esc(opts.message || '') + '</p>';
      const m = openModal({
        title: opts.title || '确认',
        bodyHTML: msg +
          '<div class="modal-actions">' +
            '<button class="btn btn-ghost" data-a="no">取消</button>' +
            '<button class="btn ' + (opts.danger ? 'btn-danger' : 'btn-primary') + '" data-a="yes">' +
              esc(opts.okText || '确定') + '</button>' +
          '</div>',
      });
      m.el.querySelector('[data-a="no"]').onclick = function () { m.close(); resolve(false); };
      m.el.querySelector('[data-a="yes"]').onclick = function () { m.close(); resolve(true); };
    });
  }

  /* ---------- 星级显示 ---------- */

  function starRowHTML(rating) {
    let html = '<span class="rc-stars">';
    for (let i = 1; i <= 5; i++) html += '<span class="' + (i <= rating ? '' : 'off') + '">★</span>';
    return html + '</span>';
  }

  /* ---------- 星级输入（点选，再点同星清除） ---------- */

  function bindStarInput(container, initial, onChange) {
    let v = initial || 0;
    const render = function () {
      let html = '<div class="star-input">';
      for (let i = 1; i <= 5; i++) {
        html += '<button class="star ' + (i <= v ? 'on' : '') + '" data-v="' + i + '" aria-label="' + i + '星">★</button>';
      }
      html += '<button class="btn-sm btn-ghost" data-act="clear" style="margin-left:8px">清除</button></div>';
      container.innerHTML = html;
      container.querySelectorAll('.star').forEach(function (b) {
        b.onclick = function () {
          v = (v === Number(b.dataset.v)) ? 0 : Number(b.dataset.v);
          onChange(v);
          render();
        };
      });
      container.querySelector('[data-act="clear"]').onclick = function () { v = 0; onChange(0); render(); };
    };
    render();
    return function () { return v; };
  }

  /* ---------- chips 多值输入（值列表 + 建议词 + 自由添加） ---------- */

  function bindChips(container, opts) {
    const values = opts.values || []; // 直接同步调用方传入的数组
    const suggestions = opts.suggestions || [];
    const onChange = opts.onChange || function () {};

    const render = function () {
      let html = '';
      if (values.length) {
        html += '<div class="chips-wrap">' + values.map(function (v, i) {
          return '<span class="chipval">' + esc(v) + '<button data-del="' + i + '" aria-label="删除">✕</button></span>';
        }).join('') + '</div>';
      }
      if (suggestions.length) {
        html += '<div class="sug-hint">点选添加：</div><div class="chips-wrap">' + suggestions.map(function (s) {
          return '<button class="chip sug ' + (values.indexOf(s) >= 0 ? 'on' : '') + '" data-sug="' + esc(s) + '">＋' + esc(s) + '</button>';
        }).join('') + '</div>';
      }
      html += '<div class="chip-add">' +
        '<input placeholder="' + esc(opts.placeholder || '输入后回车添加') + '">' +
        '<button>添加</button></div>';
      container.innerHTML = html;

      container.querySelectorAll('[data-del]').forEach(function (b) {
        b.onclick = function () {
          values.splice(Number(b.dataset.del), 1);
          onChange(values);
          render();
        };
      });
      container.querySelectorAll('[data-sug]').forEach(function (b) {
        b.onclick = function () {
          const s = b.dataset.sug;
          const i = values.indexOf(s);
          if (i >= 0) values.splice(i, 1); else values.push(s);
          onChange(values);
          render();
        };
      });

      const input = container.querySelector('.chip-add input');
      const addBtn = container.querySelector('.chip-add button');
      const add = function () {
        let v = (W2E.db ? W2E.db.normalizeIngredient(input.value) : input.value.trim());
        if (!v) return;
        if (values.indexOf(v) >= 0) { input.value = ''; return; }
        values.push(v);
        onChange(values);
        render();
        // 重新聚焦
        const ni = container.querySelector('.chip-add input');
        if (ni) ni.focus();
      };
      addBtn.onclick = add;
      input.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); add(); } });
    };
    render();
  }

  /* ---------- 滑动手势（touch + 鼠标，供 file:// 桌面使用） ---------- */

  function attachSwipe(el, handlers) {
    let startX = 0, startY = 0, dx = 0, dy = 0;
    let active = false, moved = false, t0 = 0;

    const down = function (x, y) {
      active = true; moved = false;
      startX = x; startY = y; dx = 0; dy = 0; t0 = Date.now();
      el.classList.add('swiping');
      el.style.transition = 'none';
    };
    const move = function (x, y) {
      if (!active) return;
      dx = x - startX; dy = y - startY;
      if (Math.abs(dx) > 5 || Math.abs(dy) > 5) moved = true;
      if (Math.abs(dx) > Math.abs(dy)) el.style.transform = 'translateX(' + dx + 'px) rotate(' + (dx * 0.04) + 'deg)';
      else el.style.transform = '';
    };
    const up = function () {
      if (!active) return;
      active = false;
      el.classList.remove('swiping');
      el.style.transition = '';
      el.style.transform = '';
      const dt = Date.now() - t0;
      const speed = dt > 0 ? Math.abs(dx) / dt : 0;
      const trigger = moved && Math.abs(dx) > Math.abs(dy) && (Math.abs(dx) > 80 || speed > 0.5);
      if (trigger) {
        el.dataset.swiped = '1';
        setTimeout(function () { delete el.dataset.swiped; }, 400);
        if (dx > 0 && handlers.onRight) handlers.onRight();
        else if (dx < 0 && handlers.onLeft) handlers.onLeft();
      }
    };
    // 滑动后的 click 抑制（capture 阶段拦截，避免误触卡片内按钮）
    el.addEventListener('click', function (e) {
      if (el.dataset.swiped) { e.stopPropagation(); e.preventDefault(); }
    }, true);

    el.addEventListener('touchstart', function (e) { down(e.touches[0].clientX, e.touches[0].clientY); }, { passive: true });
    el.addEventListener('touchmove', function (e) { move(e.touches[0].clientX, e.touches[0].clientY); }, { passive: true });
    el.addEventListener('touchend', up, { passive: true });
    el.addEventListener('touchcancel', up, { passive: true });
    el.addEventListener('mousedown', function (e) { if (e.button === 0) down(e.clientX, e.clientY); });
    el.addEventListener('mousemove', function (e) { move(e.clientX, e.clientY); });
    el.addEventListener('mouseup', up);
    el.addEventListener('mouseleave', up);
  }

  /* ---------- 时间格式化 ---------- */

  const DAY_MS = 86400000;

  function dayStart(now) {
    const d = new Date(now);
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  }

  function dayLabel(iso) {
    const t = new Date(iso).getTime();
    if (isNaN(t)) return '';
    const now = Date.now();
    if (t >= dayStart(now)) return '今天';
    if (t >= dayStart(now) - DAY_MS) return '昨天';
    const d = new Date(t);
    return (d.getMonth() + 1) + '月' + d.getDate() + '日';
  }

  function timeAgo(iso) {
    const t = new Date(iso).getTime();
    if (isNaN(t)) return '';
    const diff = Date.now() - t;
    if (diff < 0) return '刚刚';
    if (diff < 3600000) return Math.max(1, Math.floor(diff / 60000)) + ' 分钟前';
    if (diff < DAY_MS) return Math.floor(diff / 3600000) + ' 小时前';
    return Math.floor(diff / DAY_MS) + ' 天前';
  }

  function fmtTime(iso) {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
  }

  W2E.ui = {
    esc: esc,
    toast: toast,
    confirm: confirm,
    openModal: openModal,
    starRowHTML: starRowHTML,
    bindStarInput: bindStarInput,
    bindChips: bindChips,
    attachSwipe: attachSwipe,
    dayLabel: dayLabel,
    timeAgo: timeAgo,
    fmtTime: fmtTime,
  };
})();
