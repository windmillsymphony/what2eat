/* ============================================================
 * views.js — 各页面渲染函数与交互
 * ============================================================ */
window.W2E = window.W2E || {};

(function () {
  'use strict';

  const db = W2E.db;
  const C = W2E.consts;
  const ui = W2E.ui;
  const rec = W2E.rec;

  function unique(arr) {
    return Array.from(new Set(arr.filter(Boolean)));
  }

  /* ============================================================
   * 记录用餐弹窗（推荐页右滑 / 菜品详情「吃过了」共用）
   * ============================================================ */
  function openRecordMeal(dish, opts) {
    opts = opts || {};
    const s = db.getState();
    const invMatches = dish.source === 'homemade'
      ? s.inventory.filter(function (i) { return (dish.ingredients || []).indexOf(i.name) >= 0; })
      : [];
    let rating = 0;
    const issues = [];

    const m = ui.openModal({
      title: '记录用餐：' + dish.name,
      bodyHTML:
        '<div class="form-row"><label>评分</label><div id="rm-stars"></div></div>' +
        '<div class="form-row"><label>身体反馈</label><div class="chips-row" id="rm-issues">' +
          C.BODY_ISSUE_OPTIONS.map(function (x) { return '<button class="chip" data-i="' + x + '">' + x + '</button>'; }).join('') +
        '</div></div>' +
        '<div class="form-row"><label>备注</label><textarea id="rm-notes" rows="2" placeholder="可选，如：这家店的分量变小了"></textarea></div>' +
        (invMatches.length
          ? '<div class="form-row"><label>顺手扣减库存（可选）</label>' +
            invMatches.map(function (i) {
              return '<label class="check"><input type="checkbox" data-inv="' + ui.esc(i.name) + '"> ' +
                ui.esc(i.name) + '（' + ui.esc(i.qty) + ui.esc(i.unit || '') + '）</label>';
            }).join('') + '</div>'
          : '') +
        '<div class="modal-actions"><button class="btn btn-ghost" id="rm-cancel">取消</button>' +
        '<button class="btn btn-primary" id="rm-save">保存</button></div>',
    });

    ui.bindStarInput(m.el.querySelector('#rm-stars'), 0, function (v) { rating = v; });

    const issueBtns = m.el.querySelectorAll('#rm-issues .chip');
    const refreshIssues = function () {
      issueBtns.forEach(function (b) { b.classList.toggle('on', issues.indexOf(b.dataset.i) >= 0); });
    };
    issueBtns.forEach(function (b) {
      b.onclick = function () {
        const x = b.dataset.i;
        if (x === '无不适') {
          issues.length = 0;
          issues.push('无不适');
        } else {
          const i = issues.indexOf(x);
          if (i >= 0) issues.splice(i, 1);
          else {
            issues.push(x);
            const ni = issues.indexOf('无不适');
            if (ni >= 0) issues.splice(ni, 1);
          }
        }
        refreshIssues();
      };
    });

    m.el.querySelector('#rm-cancel').onclick = function () { m.close(); };
    m.el.querySelector('#rm-save').onclick = async function () {
      const notes = m.el.querySelector('#rm-notes').value.trim();
      db.addHistory({
        dishId: dish.id, dishName: dish.name, source: dish.source,
        eatenAt: new Date().toISOString(), wasRecommended: !!opts.wasRecommended,
        feedback: { rating: rating, bodyIssues: issues.slice(), notes: notes },
      });
      const checked = [];
      m.el.querySelectorAll('[data-inv]:checked').forEach(function (x) { checked.push(x.dataset.inv); });
      if (checked.length) {
        db.consumeInventory(checked);
        ui.toast('已扣减库存：' + checked.join('、'));
      }
      m.close();
      if (rating === 1 || issues.indexOf('过敏') >= 0) {
        const yes = await ui.confirm({
          title: '要拉黑这道菜吗？',
          message: dish.name + (rating === 1 ? ' 只评了 1 星' : ' 吃了疑似过敏') + '，拉黑后推荐不会再出现。',
          okText: '拉黑', danger: true,
        });
        if (yes) {
          db.updateDish(dish.id, { banned: true, banReason: rating === 1 ? '评过 1 星' : '吃过疑似过敏' });
          ui.toast('已拉黑');
        }
      }
      ui.toast('已记录 ✓');
      if (opts.onDone) opts.onDone();
    };
  }

  /* ============================================================
   * 首页：推荐
   * ============================================================ */
  const homeState = {
    time: 60, tired: false, light: false, any: false,
    batch: null, excluded: [], appliedRules: null, extraExclude: new Set(),
  };

  function getHomeOptions() {
    return {
      availableTimeMin: homeState.time,
      preferTakeout: homeState.tired,
      preferTags: homeState.light ? ['清淡'] : [],
    };
  }

  function runDecide(record) {
    const s = db.getState();
    const opts = getHomeOptions();
    const excludeIds = rec.buildExcludeIds(s).concat(Array.from(homeState.extraExclude));
    const r = rec.recommend(s, Object.assign({ excludeIds: excludeIds }, opts));
    homeState.batch = r.batch;
    homeState.excluded = r.excluded;
    homeState.appliedRules = r.appliedRules;
    if (r.relaxed) {
      homeState.extraExclude.clear();
      ui.toast('候选不足，从头再来');
    }
    if (record && r.batch.length) db.recordBatch(r.batch.map(function (b) { return b.dish.id; }));
    W2E.app.render();
  }

  function cardHTML(b) {
    const d = b.dish;
    const badge = d.source === 'homemade' ? '<span class="badge badge-h">自制</span>' : '<span class="badge badge-t">外卖</span>';
    const shop = d.source === 'takeout' && d.takeoutShop ? '<div class="rc-shop">🏪 ' + ui.esc(d.takeoutShop) + '</div>' : '';
    const spicy = d.taste && d.taste.spicy > 0 ? '<span class="tag spicy">🌶 ' + C.TASTE_SCALES.spicy.levels[d.taste.spicy] + '</span>' : '';
    const reasons =
      b.reasons.positives.map(function (r) { return '<li class="pos">👍 ' + ui.esc(r) + '</li>'; }).join('') +
      b.reasons.warnings.map(function (r) { return '<li class="warn">⚠️ ' + ui.esc(r) + '</li>'; }).join('');
    return '<div class="rec-card" data-id="' + d.id + '">' +
      '<div class="rc-top">' + badge + '<span class="rc-name">' + ui.esc(d.name) + '</span>' +
        (d.rating ? ui.starRowHTML(d.rating) : '') + '</div>' +
      shop +
      '<div class="rc-tags">' + spicy +
        (d.tags || []).map(function (t) { return '<span class="tag">' + ui.esc(t) + '</span>'; }).join('') +
        (d.source === 'homemade' && d.cookTimeMin ? '<span class="tag">⏱ ' + d.cookTimeMin + ' 分钟</span>' : '') +
      '</div>' +
      (reasons ? '<ul class="rc-reasons">' + reasons + '</ul>' : '') +
      '<div class="rc-actions"><button class="btn-sm primary" data-act="eat">就吃这个</button>' +
      '<button class="btn-sm" data-act="swap">换掉</button></div>' +
    '</div>';
  }

  function excludedDetailsHTML() {
    if (!homeState.excluded || !homeState.excluded.length) return '';
    return '<details class="excl"><summary>被排除的 ' + homeState.excluded.length + ' 道菜（点开看原因）</summary>' +
      homeState.excluded.map(function (e) {
        return '<div class="excl-item"><span>' + ui.esc(e.dish.name) + '</span><span class="why">' + ui.esc(e.reason) + '</span></div>';
      }).join('') + '</details>';
  }

  function recentHTML(s) {
    const recent = s.history.slice().sort(function (a, b) { return b.eatenAt.localeCompare(a.eatenAt); }).slice(0, 5);
    if (!recent.length) return '';
    return '<div class="recent"><span class="recent-title">最近吃过</span><div class="chips-row">' +
      recent.map(function (h) { return '<span class="chip">' + ui.esc(h.dishName) + ' · ' + ui.timeAgo(h.eatenAt) + '</span>'; }).join('') +
      '</div></div>';
  }

  function resultHTML(s) {
    if (s.dishes.length === 0) {
      return '<div class="card guide"><div class="guide-emoji">🍽️</div><h3>还没有菜品数据</h3>' +
        '<p>先告诉我你常吃爱吃的，我才能帮你决定下一顿</p>' +
        '<button class="btn btn-primary" onclick="location.hash=\'#/quickadd\'">快速添加常吃的 →</button>' +
        '<button class="btn btn-ghost" onclick="location.hash=\'#/dish/new\'">手动添加一道</button></div>';
    }
    if (homeState.batch === null) {
      return '<div class="empty">点上面的按钮，让我帮你想想<br>也可以先到「菜品」页录入爱吃的菜</div>';
    }
    if (homeState.batch.length === 0) {
      return '<div class="empty">没有符合条件的菜 😢<br>试试结束特殊时期，或到「我的 → 偏好与忌口」调整规则</div>' +
        excludedDetailsHTML();
    }
    const visible = homeState.batch.filter(function (b) { return s.dishes.some(function (d) { return d.id === b.dish.id; }); });
    if (!visible.length) {
      return '<div class="empty">候选菜品已被删除<br>重新点一下「帮我决定」</div>';
    }
    return '<div class="hint-row">← 左滑换掉 · 右滑就吃这个 · 点卡片看详情 →</div>' +
      visible.map(cardHTML).join('') +
      '<button class="btn btn-ghost btn-big" id="rerollBtn">🔄 换一批</button>' +
      excludedDetailsHTML();
  }

  function home(c) {
    const s = db.getState();
    const active = rec.getActivePeriods(s);
    const banner = active.length
      ? '<div class="banner banner-warn">🌡️ ' + active.map(function (p) { return p.name; }).join('、') + '中' +
        (homeState.batch && homeState.excluded.length ? ' · 已过滤 ' + homeState.excluded.length + ' 道菜' : '') +
        '<div class="banner-sub">' + C.DISCLAIMER + '</div></div>'
      : '';

    c.innerHTML =
      '<div class="home">' +
      banner +
      '<div class="chips-row">' +
        '<button class="chip ' + (homeState.tired ? 'on' : '') + '" data-scene="tired">😴 今天很累</button>' +
        '<button class="chip ' + (homeState.light ? 'on' : '') + '" data-scene="light">🥗 想吃清淡</button>' +
        '<button class="chip ' + (homeState.any ? 'on' : '') + '" data-scene="any">🎲 随便吃点</button>' +
      '</div>' +
      '<div class="seg">' +
        [15, 30, 60, 120].map(function (t) {
          return '<button data-t="' + t + '" class="' + (homeState.time === t ? 'on' : '') + '">' + (t === 120 ? '不着急' : t + '分钟') + '</button>';
        }).join('') +
      '</div>' +
      '<button class="btn btn-primary btn-big" id="decideBtn">🎲 帮我决定</button>' +
      '<div id="resultArea">' + resultHTML(s) + '</div>' +
      recentHTML(s) +
      '</div>';

    c.querySelectorAll('[data-scene]').forEach(function (b) {
      b.onclick = function () {
        const k = b.dataset.scene;
        if (k === 'tired') homeState.tired = !homeState.tired;
        if (k === 'light') homeState.light = !homeState.light;
        if (k === 'any') {
          homeState.any = !homeState.any;
          if (homeState.any) { homeState.tired = false; homeState.light = false; }
        }
        W2E.app.render();
      };
    });
    c.querySelectorAll('[data-t]').forEach(function (b) {
      b.onclick = function () { homeState.time = Number(b.dataset.t); W2E.app.render(); };
    });
    c.querySelector('#decideBtn').onclick = function () { runDecide(true); };

    if (homeState.batch) {
      c.querySelectorAll('.rec-card').forEach(function (el) {
        const id = el.dataset.id;
        const dish = s.dishes.find(function (x) { return x.id === id; });
        if (!dish) return;
        ui.attachSwipe(el, {
          onRight: function () {
            openRecordMeal(dish, { wasRecommended: true, onDone: function () { runDecide(false); } });
          },
          onLeft: function () {
            homeState.extraExclude.add(id);
            runDecide(true);
          },
        });
        el.addEventListener('click', function () {
          if (el.dataset.swiped) return;
          location.hash = '#/dish/' + id;
        });
        el.querySelector('[data-act="eat"]').onclick = function (e) {
          e.stopPropagation();
          if (el.dataset.swiped) return;
          openRecordMeal(dish, { wasRecommended: true, onDone: function () { runDecide(false); } });
        };
        el.querySelector('[data-act="swap"]').onclick = function (e) {
          e.stopPropagation();
          if (el.dataset.swiped) return;
          homeState.extraExclude.add(id);
          runDecide(true);
        };
      });
      const reroll = c.querySelector('#rerollBtn');
      if (reroll) reroll.onclick = function () { runDecide(true); };
    }

    // 冷启动：有数据但还没出过结果，自动跑一次
    if (s.dishes.length > 0 && !homeState.batch) runDecide(false);
  }

  /* ============================================================
   * 菜品列表
   * ============================================================ */
  const dishesState = { q: '', filter: '' };
  const FILTER_LABELS = { '': '全部', homemade: '自制', takeout: '外卖', loved: '♥ 爱吃', banned: '踩雷', archived: '已归档' };

  function dishRowHTML(d) {
    const badge = d.source === 'homemade' ? '<span class="badge badge-h">自制</span>' : '<span class="badge badge-t">外卖</span>';
    const sub = d.source === 'takeout'
      ? (d.takeoutShop || '') + ((d.tags || []).length ? ' · ' + d.tags.join('、') : '')
      : ((d.ingredients || []).join('、') || '无食材') + (d.cookTimeMin ? ' · ' + d.cookTimeMin + '分钟' : '') + ((d.tags || []).length ? ' · ' + d.tags.join('、') : '');
    const rowClass = 'row' + (d.status === 'archived' ? ' row-archived' : '') + (d.banned ? ' row-banned' : '');
    return '<div class="' + rowClass + '" data-id="' + d.id + '">' +
      '<div class="row-main"><div class="row-name">' + badge + ' ' + ui.esc(d.name) +
        (d.banned ? '<span class="badge badge-danger">拉黑</span>' : '') + '</div>' +
      '<div class="row-sub">' + ui.esc(sub) + '</div></div>' +
      '<div class="row-side">' +
        '<button class="heart ' + (d.loved ? 'on' : '') + '" data-act="love" aria-label="爱吃">' + (d.loved ? '♥' : '♡') + '</button>' +
        '<button class="icon-btn" data-act="menu" aria-label="更多">⋯</button>' +
      '</div></div>';
  }

  function renderDishList(c) {
    const s = db.getState();
    const q = dishesState.q.trim().toLowerCase();
    const list = s.dishes.filter(function (d) {
      if (dishesState.filter === 'homemade' && d.source !== 'homemade') return false;
      if (dishesState.filter === 'takeout' && d.source !== 'takeout') return false;
      if (dishesState.filter === 'loved' && !d.loved) return false;
      if (dishesState.filter === 'banned' && !d.banned) return false;
      if (dishesState.filter === 'archived' && d.status !== 'archived') return false;
      if (q) {
        const hay = (d.name + ' ' + (d.takeoutShop || '') + ' ' + (d.ingredients || []).join(' ')).toLowerCase();
        if (hay.indexOf(q) < 0) return false;
      }
      return true;
    });
    const wrap = c.querySelector('#dishListWrap');
    wrap.innerHTML = list.length
      ? '<div class="list">' + list.map(dishRowHTML).join('') + '</div>'
      : '<div class="empty">没有符合条件的菜' + (s.dishes.length === 0 ? '<br>点右下角 ＋ 添加你的第一道菜' : '') + '</div>';

    wrap.querySelectorAll('.row').forEach(function (row) {
      row.onclick = function () { location.hash = '#/dish/' + row.dataset.id; };
    });
    wrap.querySelectorAll('[data-act="love"]').forEach(function (b) {
      b.onclick = function (e) {
        e.stopPropagation();
        const d = s.dishes.find(function (x) { return x.id === b.closest('.row').dataset.id; });
        if (d) db.updateDish(d.id, { loved: !d.loved });
      };
    });
    wrap.querySelectorAll('[data-act="menu"]').forEach(function (b) {
      b.onclick = function (e) {
        e.stopPropagation();
        const d = s.dishes.find(function (x) { return x.id === b.closest('.row').dataset.id; });
        if (d) dishActionMenu(d);
      };
    });
  }

  async function askBan(d) {
    const m = ui.openModal({
      title: '拉黑：' + d.name,
      bodyHTML:
        '<input class="input" id="banReason" placeholder="原因（可选）如：太咸，牛肉嚼不动">' +
        '<div class="modal-actions"><button class="btn btn-ghost" id="bc-cancel">取消</button>' +
        '<button class="btn btn-danger" id="bc-ok">拉黑</button></div>',
    });
    m.el.querySelector('#bc-cancel').onclick = function () { m.close(); };
    m.el.querySelector('#bc-ok').onclick = function () {
      db.updateDish(d.id, { banned: true, banReason: m.el.querySelector('#banReason').value.trim() });
      m.close();
      ui.toast('已拉黑，推荐不会再出现');
    };
  }

  function dishActionMenu(d) {
    const m = ui.openModal({
      title: d.name,
      bodyHTML:
        '<div class="data-actions">' +
        '<button class="btn btn-ghost" data-a="edit">✏️ 编辑</button>' +
        '<button class="btn btn-ghost" data-a="ban">' + (d.banned ? '♻️ 取消拉黑' : '🚫 拉黑') + '</button>' +
        '<button class="btn btn-ghost" data-a="archive">' + (d.status === 'archived' ? '📂 取消归档' : '📦 归档') + '</button>' +
        '<button class="btn btn-danger" data-a="del">🗑 删除</button>' +
        '</div>',
    });
    m.el.querySelector('[data-a="edit"]').onclick = function () { m.close(); location.hash = '#/dish/' + d.id + '/edit'; };
    m.el.querySelector('[data-a="ban"]').onclick = function () {
      m.close();
      if (d.banned) { db.updateDish(d.id, { banned: false, banReason: '' }); ui.toast('已取消拉黑'); }
      else askBan(d);
    };
    m.el.querySelector('[data-a="archive"]').onclick = function () {
      m.close();
      db.updateDish(d.id, { status: d.status === 'archived' ? 'active' : 'archived' });
      ui.toast(d.status === 'archived' ? '已取消归档' : '已归档，推荐不再出现');
    };
    m.el.querySelector('[data-a="del"]').onclick = async function () {
      m.close();
      const ok = await ui.confirm({ title: '删除这道菜？', message: '删除「' + d.name + '」后不可恢复，历史记录会保留菜名。', okText: '删除', danger: true });
      if (ok) { db.deleteDish(d.id); ui.toast('已删除'); }
    };
  }

  function dishes(c) {
    c.innerHTML =
      '<div class="dishes">' +
      '<input class="search" id="dishSearch" placeholder="🔍 搜索菜名 / 食材 / 店名" value="' + ui.esc(dishesState.q) + '">' +
      '<div class="chips-row" id="dishFilters">' +
        Object.keys(FILTER_LABELS).map(function (k) {
          return '<button class="chip ' + (dishesState.filter === k ? 'on' : '') + '" data-f="' + k + '">' + FILTER_LABELS[k] + '</button>';
        }).join('') +
      '</div>' +
      '<div id="dishListWrap"></div>' +
      '<button class="fab" id="addDishBtn" aria-label="添加菜品">＋</button>' +
      '</div>';

    renderDishList(c);

    c.querySelector('#dishSearch').addEventListener('input', function (e) {
      dishesState.q = e.target.value;
      renderDishList(c);
    });
    c.querySelectorAll('#dishFilters .chip').forEach(function (b) {
      b.onclick = function () {
        dishesState.filter = b.dataset.f;
        c.querySelectorAll('#dishFilters .chip').forEach(function (x) { x.classList.toggle('on', x === b); });
        renderDishList(c);
      };
    });
    c.querySelector('#addDishBtn').onclick = function () { location.hash = '#/dish/new'; };
  }

  /* ============================================================
   * 菜品表单（新增 / 编辑）
   * ============================================================ */
  function sliderHTML(key, val) {
    const scale = C.TASTE_SCALES[key];
    return '<div class="slider-row"><div class="slider-label"><span>' + scale.label + '</span>' +
      '<span class="slider-val" id="sv-' + key + '">' + scale.levels[val] + '</span></div>' +
      '<input type="range" min="0" max="5" step="1" value="' + val + '" data-taste="' + key + '"></div>';
  }

  function dishForm(c, id) {
    const s = db.getState();
    let d = null;
    if (id) {
      d = s.dishes.find(function (x) { return x.id === id; });
      if (!d) {
        c.innerHTML = '<div class="empty">菜品不存在或已删除</div>' +
          '<div class="center"><button class="btn btn-ghost" onclick="location.hash=\'#/dishes\'">返回列表</button></div>';
        return;
      }
    }
    const f = d ? JSON.parse(JSON.stringify(d)) : {
      name: '', source: 'homemade', takeoutShop: '', category: '家常菜',
      tags: [], taste: { spicy: 0, salty: 0, sweet: 0, sour: 0, texture: '', temp: 'hot' },
      ingredients: [], cookTimeMin: 15, rating: 0, loved: false, notes: '',
    };
    f.taste = Object.assign({ spicy: 0, salty: 0, sweet: 0, sour: 0, texture: '', temp: 'hot' }, f.taste || {});
    f.tags = f.tags || [];
    f.ingredients = f.ingredients || [];
    let rating = f.rating || 0;

    const knownIngredients = unique([].concat(
      s.dishes.reduce(function (a, x) { return a.concat(x.ingredients || []); }, []),
      s.inventory.map(function (x) { return x.name; })
    ));
    const knownTags = unique(C.TAG_SUGGESTIONS.concat(
      s.dishes.reduce(function (a, x) { return a.concat(x.tags || []); }, [])
    ));

    c.innerHTML =
      '<form id="dishForm" class="form">' +
      '<div class="form-row"><label>菜名 *</label><input class="input" id="f-name" value="' + ui.esc(f.name) + '" placeholder="如：番茄鸡蛋面"></div>' +
      '<div class="form-row"><label>来源</label><div class="seg" id="f-src">' +
        '<button type="button" data-src="homemade" class="' + (f.source === 'homemade' ? 'on' : '') + '">🍳 自制</button>' +
        '<button type="button" data-src="takeout" class="' + (f.source === 'takeout' ? 'on' : '') + '">🛵 外卖</button></div></div>' +
      '<div class="form-row" id="f-shop-row" style="' + (f.source === 'takeout' ? '' : 'display:none') + '"><label>店名 *</label>' +
        '<input class="input" id="f-shop" value="' + ui.esc(f.takeoutShop || '') + '" placeholder="如：杨国福麻辣烫"></div>' +
      '<div class="form-row"><label>分类</label><select class="select" id="f-cat">' +
        C.DISH_CATEGORIES.map(function (x) { return '<option' + (f.category === x ? ' selected' : '') + '>' + x + '</option>'; }).join('') +
      '</select></div>' +
      '<div class="form-row"><label>标签（忌口规则靠它匹配，建议从词表选）</label><div id="f-tags"></div></div>' +
      '<div class="form-row"><label>口味</label>' + ['spicy', 'salty', 'sweet', 'sour'].map(function (k) { return sliderHTML(k, f.taste[k]); }).join('') +
        '<div class="form-row"><label>口感</label><select class="select" id="f-texture">' +
          '<option value="">未设置</option>' + C.TEXTURE_OPTIONS.map(function (x) { return '<option' + (f.taste.texture === x ? ' selected' : '') + '>' + x + '</option>'; }).join('') +
        '</select></div>' +
        '<div class="form-row"><label>温度</label><div class="seg" id="f-temp">' +
          Object.keys(C.TEMP_OPTIONS).map(function (k) {
            return '<button type="button" data-temp="' + k + '" class="' + (f.taste.temp === k ? 'on' : '') + '">' + C.TEMP_OPTIONS[k] + '</button>';
          }).join('') +
        '</div></div>' +
      '</div>' +
      '<div class="form-row"><label>食材（推荐时和家里库存匹配）</label><div id="f-ingredients"></div></div>' +
      '<div class="form-row" id="f-time-row" style="' + (f.source === 'homemade' ? '' : 'display:none') + '"><label>烹饪时间（分钟）</label>' +
        '<input class="input" id="f-time" type="number" min="0" max="600" value="' + (f.cookTimeMin || '') + '"></div>' +
      '<div class="form-row"><label>评分</label><div id="f-rating"></div></div>' +
      '<div class="form-row"><label class="check"><input type="checkbox" id="f-loved"' + (f.loved ? ' checked' : '') + '> ♥ 标记为爱吃</label></div>' +
      '<div class="form-row"><label>备注</label><textarea id="f-notes" rows="2" placeholder="如：上次多放半勺盐刚刚好">' + ui.esc(f.notes || '') + '</textarea></div>' +
      '<div class="modal-actions"><button type="button" class="btn btn-ghost" id="f-cancel">取消</button>' +
      '<button type="submit" class="btn btn-primary">保存</button></div>' +
      '</form>';

    c.querySelectorAll('#f-src button').forEach(function (b) {
      b.onclick = function () {
        f.source = b.dataset.src;
        c.querySelectorAll('#f-src button').forEach(function (x) { x.classList.toggle('on', x === b); });
        c.querySelector('#f-shop-row').style.display = f.source === 'takeout' ? '' : 'none';
        c.querySelector('#f-time-row').style.display = f.source === 'homemade' ? '' : 'none';
      };
    });
    c.querySelectorAll('#f-temp button').forEach(function (b) {
      b.onclick = function () {
        f.taste.temp = b.dataset.temp;
        c.querySelectorAll('#f-temp button').forEach(function (x) { x.classList.toggle('on', x === b); });
      };
    });
    ['spicy', 'salty', 'sweet', 'sour'].forEach(function (k) {
      const input = c.querySelector('[data-taste="' + k + '"]');
      const val = c.querySelector('#sv-' + k);
      input.addEventListener('input', function () {
        f.taste[k] = Number(input.value);
        val.textContent = C.TASTE_SCALES[k].levels[f.taste[k]];
      });
    });
    ui.bindChips(c.querySelector('#f-tags'), { values: f.tags, suggestions: knownTags, placeholder: '输入自定义标签' });
    ui.bindChips(c.querySelector('#f-ingredients'), { values: f.ingredients, suggestions: knownIngredients, placeholder: '如：鸡蛋，回车添加' });
    ui.bindStarInput(c.querySelector('#f-rating'), rating, function (v) { rating = v; });

    c.querySelector('#f-cancel').onclick = function () { history.back(); };
    c.querySelector('#dishForm').onsubmit = function (e) {
      e.preventDefault();
      const name = c.querySelector('#f-name').value.trim();
      if (!name) { ui.toast('请填写菜名'); return; }
      f.name = name;
      if (f.source === 'takeout') {
        f.takeoutShop = c.querySelector('#f-shop').value.trim();
        if (!f.takeoutShop) { ui.toast('外卖菜品请填写店名'); return; }
      } else {
        f.takeoutShop = '';
      }
      f.category = c.querySelector('#f-cat').value;
      f.taste.texture = c.querySelector('#f-texture').value;
      f.cookTimeMin = Number(c.querySelector('#f-time').value) || 0;
      f.rating = rating;
      f.loved = c.querySelector('#f-loved').checked;
      f.notes = c.querySelector('#f-notes').value.trim();
      if (d) {
        db.updateDish(d.id, f);
        ui.toast('已保存');
        location.hash = '#/dish/' + d.id;
      } else {
        const nid = db.addDish(f);
        ui.toast('已添加');
        location.hash = '#/dish/' + nid;
      }
    };
  }

  /* ============================================================
   * 菜品详情
   * ============================================================ */
  function historyRowHTML(h) {
    const f = h.feedback || {};
    return '<div class="h-row">' +
      '<div class="h-main">' +
        '<div class="h-name">' + ui.esc(h.dishName || '已删除菜品') +
          (h.source === 'takeout' ? ' <span class="badge badge-t">外卖</span>' : ' <span class="badge badge-h">自制</span>') +
          (h.wasRecommended ? ' <span class="tag">推荐</span>' : '') + '</div>' +
        '<div class="h-meta">' + ui.fmtTime(h.eatenAt) +
          (f.rating ? ' · ' + '★'.repeat(f.rating) : '') +
          ((f.bodyIssues || []).length ? ' · ' + f.bodyIssues.join('、') : '') + '</div>' +
        (f.notes ? '<div class="h-notes">' + ui.esc(f.notes) + '</div>' : '') +
      '</div>' +
      '<button class="h-del" data-del-h="' + h.id + '" aria-label="删除">🗑</button>' +
    '</div>';
  }

  function bindHistoryDelete(scope) {
    scope.querySelectorAll('[data-del-h]').forEach(function (b) {
      b.onclick = async function (e) {
        e.stopPropagation();
        const ok = await ui.confirm({ title: '删除这条记录？', message: '删除后推荐的历史统计会相应变化。', okText: '删除', danger: true });
        if (ok) { db.deleteHistory(b.dataset.delH); ui.toast('已删除'); }
      };
    });
  }

  function dishDetail(c, id) {
    const s = db.getState();
    const d = s.dishes.find(function (x) { return x.id === id; });
    if (!d) {
      c.innerHTML = '<div class="empty">菜品不存在或已删除</div>' +
        '<div class="center"><button class="btn btn-ghost" onclick="location.hash=\'#/dishes\'">返回列表</button></div>';
      return;
    }
    const stats = rec.deriveStats(s, Date.now())[d.id];
    const entries = s.history.filter(function (h) { return h.dishId === d.id; })
      .sort(function (a, b) { return b.eatenAt.localeCompare(a.eatenAt); }).slice(0, 5);
    const pits = s.pitfalls.filter(function (p) { return p.dishId === d.id; });
    const t = d.taste || {};
    const tasteParts = [];
    if (t.spicy > 0) tasteParts.push(C.TASTE_SCALES.spicy.levels[t.spicy]);
    if (t.salty > 0) tasteParts.push(C.TASTE_SCALES.salty.levels[t.salty]);
    if (t.sweet > 0) tasteParts.push(C.TASTE_SCALES.sweet.levels[t.sweet]);
    if (t.sour > 0) tasteParts.push(C.TASTE_SCALES.sour.levels[t.sour]);
    if (t.texture) tasteParts.push('口感' + t.texture);
    if (C.TEMP_OPTIONS[t.temp]) tasteParts.push(C.TEMP_OPTIONS[t.temp]);

    c.innerHTML =
      '<div class="detail">' +
      '<div class="card">' +
        '<div class="rc-top"><span class="badge ' + (d.source === 'homemade' ? 'badge-h' : 'badge-t') + '">' + (d.source === 'homemade' ? '自制' : '外卖') + '</span>' +
        '<span class="rc-name">' + ui.esc(d.name) + '</span>' +
        (d.banned ? '<span class="badge badge-danger">已拉黑</span>' : '') +
        (d.status === 'archived' ? '<span class="badge">已归档</span>' : '') + '</div>' +
        (d.source === 'takeout' && d.takeoutShop ? '<div class="rc-shop">🏪 ' + ui.esc(d.takeoutShop) + '</div>' : '') +
        '<div class="rc-tags">' +
          (d.rating ? '<span class="tag">' + ui.starRowHTML(d.rating) + '</span>' : '') +
          (d.loved ? '<span class="tag">♥ 爱吃</span>' : '') +
          (d.tags || []).map(function (x) { return '<span class="tag">' + ui.esc(x) + '</span>'; }).join('') +
        '</div>' +
        '<div style="font-size:13px;color:var(--muted);margin-top:8px">' +
          (tasteParts.length ? ui.esc(tasteParts.join(' · ')) + '<br>' : '') +
          ((d.ingredients || []).length ? '食材：' + ui.esc(d.ingredients.join('、')) + '<br>' : '') +
          (d.source === 'homemade' && d.cookTimeMin ? '烹饪时间：' + d.cookTimeMin + ' 分钟<br>' : '') +
          (stats ? '吃过 ' + stats.eatCount + ' 次' +
            (stats.lastEatenAt ? ' · 上次 ' + ui.timeAgo(new Date(stats.lastEatenAt).toISOString()) : '') +
            (stats.recentIssues.length ? ' · 最近问题：' + stats.recentIssues.join('、') : '') + '<br>' : '') +
          (d.banReason ? '拉黑原因：' + ui.esc(d.banReason) + '<br>' : '') +
          (d.notes ? '备注：' + ui.esc(d.notes) + '<br>' : '') +
        '</div>' +
        '<div class="rc-actions" style="margin-top:14px">' +
          '<button class="btn-sm primary" id="dt-eat" style="flex:2">🍽 吃过了</button>' +
          '<button class="btn-sm" id="dt-edit">✏️ 编辑</button>' +
        '</div>' +
        '<div class="rc-actions">' +
          '<button class="btn-sm" id="dt-ban">' + (d.banned ? '♻️ 取消拉黑' : '🚫 拉黑') + '</button>' +
          '<button class="btn-sm" id="dt-archive">' + (d.status === 'archived' ? '📂 取消归档' : '📦 归档') + '</button>' +
          '<button class="btn-sm" id="dt-del" style="color:var(--danger)">🗑 删除</button>' +
        '</div>' +
      '</div>' +
      (pits.length ? '<div class="card"><b style="font-size:14px">💣 踩雷记录</b>' + pits.map(function (p) {
        return '<div class="excl-item"><span>' + ui.esc(p.problem) + '</span><span class="why">' + (p.severity === 'hard' ? '拉黑' : '提醒') + '</span></div>';
      }).join('') + '</div>' : '') +
      (entries.length ? '<div class="card"><b style="font-size:14px">📅 最近记录</b>' + entries.map(historyRowHTML).join('') + '</div>' : '') +
      '</div>';

    c.querySelector('#dt-eat').onclick = function () {
      openRecordMeal(d, { onDone: function () { W2E.app.render(); } });
    };
    c.querySelector('#dt-edit').onclick = function () { location.hash = '#/dish/' + d.id + '/edit'; };
    c.querySelector('#dt-ban').onclick = function () {
      if (d.banned) { db.updateDish(d.id, { banned: false, banReason: '' }); ui.toast('已取消拉黑'); }
      else askBan(d);
    };
    c.querySelector('#dt-archive').onclick = function () {
      db.updateDish(d.id, { status: d.status === 'archived' ? 'active' : 'archived' });
      ui.toast(d.status === 'archived' ? '已取消归档' : '已归档，推荐不再出现');
    };
    c.querySelector('#dt-del').onclick = async function () {
      const ok = await ui.confirm({ title: '删除这道菜？', message: '删除「' + d.name + '」后不可恢复，历史记录会保留菜名。', okText: '删除', danger: true });
      if (ok) { db.deleteDish(d.id); ui.toast('已删除'); location.hash = '#/dishes'; }
    };
    bindHistoryDelete(c);
  }

  /* ============================================================
   * 库存
   * ============================================================ */
  function invRowHTML(i) {
    const numeric = /^\d+/.test(i.qty || '');
    return '<div class="row" style="cursor:default">' +
      '<div class="row-main"><div class="row-name">' + ui.esc(i.name) + '</div>' +
      '<div class="row-sub">' + (i.qty || '') + (i.unit || '') + ' · ' + ui.timeAgo(i.addedAt) + '添加</div></div>' +
      '<div class="row-side">' +
      '<button class="icon-btn" data-inv-act="' + i.id + '" data-act="minus" aria-label="减少">−</button>' +
      (numeric ? '<button class="icon-btn" data-inv-act="' + i.id + '" data-act="plus" aria-label="增加">＋</button>' : '') +
      '<button class="icon-btn" data-inv-act="' + i.id + '" data-act="del" aria-label="用完">🗑</button>' +
      '</div></div>';
  }

  function inventory(c) {
    const s = db.getState();
    c.innerHTML =
      '<div class="inv">' +
      '<div class="card">' +
        '<div class="form-row"><input class="input" id="inv-name" placeholder="食材名，如：鸡蛋"></div>' +
        '<div class="qty-row">' +
          '<input class="input" id="inv-qty" placeholder="数量" inputmode="numeric">' +
          '<input class="input" id="inv-unit" placeholder="单位（个 / 斤 / 袋）">' +
        '</div>' +
        '<select class="select" id="inv-cat" style="margin-top:8px">' +
          C.INVENTORY_CATEGORIES.map(function (x) { return '<option>' + x + '</option>'; }).join('') +
        '</select>' +
        '<button class="btn btn-primary" id="inv-add" style="width:100%;margin-top:10px">＋ 添加</button>' +
      '</div>' +
      (s.inventory.length
        ? '<div class="list">' + C.INVENTORY_CATEGORIES.map(function (cat) {
            const items = s.inventory.filter(function (i) { return (i.category || '其他') === cat; });
            if (!items.length) return '';
            return '<div class="row" style="cursor:default;background:var(--bg);color:var(--muted);font-size:12px;font-weight:600;padding:6px 14px;border-bottom:none">' + cat + '</div>' +
              items.map(invRowHTML).join('');
          }).join('') + '</div>'
        : '<div class="empty">还没有库存<br>登记后推荐会告诉你家里能做什么</div>') +
      '</div>';

    const add = function () {
      const name = db.normalizeIngredient(c.querySelector('#inv-name').value);
      if (!name) { ui.toast('请填写食材名'); return; }
      if (s.inventory.some(function (i) { return i.name === name; })) { ui.toast('库存里已有「' + name + '」'); return; }
      db.addInventoryItem({
        name: name,
        qty: c.querySelector('#inv-qty').value.trim(),
        unit: c.querySelector('#inv-unit').value.trim(),
        category: c.querySelector('#inv-cat').value,
      });
      ui.toast('已添加');
    };
    c.querySelector('#inv-add').onclick = add;
    c.querySelector('#inv-name').addEventListener('keydown', function (e) { if (e.key === 'Enter') add(); });

    c.querySelectorAll('[data-inv-act]').forEach(function (b) {
      b.onclick = function (e) {
        e.stopPropagation();
        const item = s.inventory.find(function (x) { return x.id === b.dataset.invAct; });
        if (!item) return;
        const act = b.dataset.act;
        if (act === 'del') { db.deleteInventoryItem(item.id); return; }
        const m = /^(\d+)/.exec(item.qty || '');
        const n = m ? parseInt(m[1], 10) : 0;
        const nn = Math.max(0, n + (act === 'plus' ? 1 : -1));
        if (n === 0) {
          if (act === 'plus') db.updateInventoryItem(item.id, { qty: '1' });
          return;
        }
        if (nn === 0) db.deleteInventoryItem(item.id);
        else db.updateInventoryItem(item.id, { qty: m ? item.qty.replace(m[1], String(nn)) : String(nn) });
      };
    });
  }

  /* ============================================================
   * 特殊时期
   * ============================================================ */
  function rulesSummaryHTML(r) {
    const lines = [];
    if ((r.forbidTags || []).length) lines.push('<li>忌口标签：' + ui.esc(r.forbidTags.join('、')) + '</li>');
    if ((r.forbidIngredients || []).length) lines.push('<li>忌口食材：' + ui.esc(r.forbidIngredients.join('、')) + '</li>');
    if ((r.forbidDishes || []).length) lines.push('<li>忌口菜品：' + (r.forbidDishes.length) + ' 道</li>');
    if ((r.forbidShops || []).length) lines.push('<li>忌口店铺：' + ui.esc(r.forbidShops.join('、')) + '</li>');
    if (r.maxSpicy != null) lines.push('<li>辣度上限：' + C.TASTE_SCALES.spicy.levels[r.maxSpicy] + '及以下</li>');
    if (r.requireCooked) lines.push('<li>只推荐自制</li>');
    if ((r.preferTags || []).length) lines.push('<li>偏好标签：' + ui.esc(r.preferTags.join('、')) + '</li>');
    return '<ul class="rule-summary">' + (lines.length ? lines.join('') : '<li class="none">无规则</li>') + '</ul>';
  }

  function periodCardHTML(p, active) {
    const days = p.startedAt ? Math.floor((Date.now() - new Date(p.startedAt).getTime()) / 86400000) + 1 : 1;
    const r = p.rules || {};
    const summary = [];
    if ((r.forbidTags || []).length) summary.push('忌口标签：' + r.forbidTags.join('、'));
    if ((r.forbidIngredients || []).length) summary.push('忌口食材：' + r.forbidIngredients.join('、'));
    if (r.maxSpicy != null) summary.push('辣度上限：' + C.TASTE_SCALES.spicy.levels[r.maxSpicy]);
    if (r.requireCooked) summary.push('只推荐自制');
    if ((r.preferTags || []).length) summary.push('偏好：' + r.preferTags.join('、'));
    return '<div class="period-card' + (active ? ' active' : '') + '">' +
      '<div class="period-head"><span class="period-name">' + (active ? '🟡 ' : '') + ui.esc(p.name) + '</span>' +
      '<span class="period-days">' + (active ? '已第 ' + days + ' 天' : '已结束') + '</span></div>' +
      '<div class="period-rules">' + (summary.length ? ui.esc(summary.join(' · ')) : '无规则') + '</div>' +
      (p.notes ? '<div class="period-rules">' + ui.esc(p.notes) + '</div>' : '') +
      (active
        ? '<div class="period-actions"><button class="btn-sm" data-edit-period="' + p.id + '">编辑规则</button>' +
          '<button class="btn-sm" data-end-period="' + p.id + '">结束</button></div>'
        : '<div class="period-actions"><button class="btn-sm" data-del-period="' + p.id + '">删除记录</button></div>') +
      '</div>';
  }

  function rulesFormHTML(r) {
    return '<div class="form-row"><label>忌口食材</label><div class="rf-ingredients"></div></div>' +
      '<div class="form-row"><label>忌口标签</label><div class="rf-tags"></div></div>' +
      '<div class="form-row"><label>忌口菜品</label><div class="rf-dishes"></div></div>' +
      '<div class="form-row"><label>忌口店铺</label><div class="rf-shops"></div></div>' +
      '<div class="form-row"><label>辣度上限</label><select class="select rf-spicy">' +
        '<option value=""' + (r.maxSpicy == null ? ' selected' : '') + '>不限制</option>' +
        [1, 2, 3, 4, 5].map(function (v) {
          return '<option value="' + v + '"' + (r.maxSpicy === v ? ' selected' : '') + '>' + C.TASTE_SCALES.spicy.levels[v] + '及以下</option>';
        }).join('') +
      '</select></div>' +
      '<div class="form-row"><label>偏好标签（推荐加分）</label><div class="rf-prefer"></div></div>' +
      '<label class="check"><input type="checkbox" class="rf-cooked"' + (r.requireCooked ? ' checked' : '') + '> 只推荐自制（自己做的更放心）</label>';
  }

  function bindDishChips(box, selectedIds) {
    const dishes = db.getState().dishes.filter(function (d) { return d.status === 'active'; });
    if (!dishes.length) { box.innerHTML = '<div class="empty" style="padding:4px">还没有菜品</div>'; return; }
    box.innerHTML = '<div class="chips-wrap">' + dishes.map(function (d) {
      return '<button class="chip ' + (selectedIds.indexOf(d.id) >= 0 ? 'on' : '') + '" data-id="' + d.id + '">' + ui.esc(d.name) + '</button>';
    }).join('') + '</div>';
    box.querySelectorAll('.chip').forEach(function (b) {
      b.onclick = function () {
        const i = selectedIds.indexOf(b.dataset.id);
        if (i >= 0) selectedIds.splice(i, 1); else selectedIds.push(b.dataset.id);
        b.classList.toggle('on');
      };
    });
  }

  function bindRulesForm(scope, rules) {
    const s = db.getState();
    const ingKnown = unique([].concat(
      s.dishes.reduce(function (a, x) { return a.concat(x.ingredients || []); }, []),
      s.inventory.map(function (x) { return x.name; })
    ));
    ui.bindChips(scope.querySelector('.rf-ingredients'), { values: rules.forbidIngredients, suggestions: ingKnown, placeholder: '如：海鲜' });
    ui.bindChips(scope.querySelector('.rf-tags'), { values: rules.forbidTags, suggestions: C.TAG_SUGGESTIONS });
    // 忌口店铺不提供建议词，只支持手动输入
    ui.bindChips(scope.querySelector('.rf-shops'), { values: rules.forbidShops, suggestions: [], placeholder: '如：杨国福麻辣烫' });
    ui.bindChips(scope.querySelector('.rf-prefer'), { values: rules.preferTags, suggestions: C.TAG_SUGGESTIONS });
    bindDishChips(scope.querySelector('.rf-dishes'), rules.forbidDishes);
    scope.querySelector('.rf-spicy').onchange = function (e) { rules.maxSpicy = e.target.value === '' ? null : Number(e.target.value); };
    scope.querySelector('.rf-cooked').onchange = function (e) { rules.requireCooked = e.target.checked; };
  }

  function newRulesObj() {
    return { forbidIngredients: [], forbidTags: [], forbidDishes: [], forbidShops: [], maxSpicy: null, preferTags: [], requireCooked: false };
  }

  async function startTemplate(tplId) {
    const t = C.SPECIAL_PERIOD_TEMPLATES.find(function (x) { return x.id === tplId; });
    if (!t) return;
    const ok = await ui.confirm({
      title: '开启「' + t.name + '」',
      messageHTML: rulesSummaryHTML(t.rules) +
        (t.suggestedDays ? '<p style="margin-top:6px;color:var(--muted)">建议持续 ' + t.suggestedDays + ' 天，可随时手动结束</p>' : '') +
        '<p class="disclaimer">' + C.DISCLAIMER + '</p>',
      okText: '开启',
    });
    if (!ok) return;
    db.addPeriod({
      templateId: t.id, name: t.name, enabled: true,
      startedAt: new Date().toISOString(), endedAt: null,
      suggestedDays: t.suggestedDays,
      rules: JSON.parse(JSON.stringify(t.rules)),
      notes: t.notes,
    });
    ui.toast('已开启「' + t.name + '」');
  }

  function openCustomPeriod() {
    const rules = newRulesObj();
    const m = ui.openModal({
      title: '自定义特殊时期',
      bodyHTML:
        '<div class="form-row"><label>名称 *</label><input class="input" id="cp-name" placeholder="如：拔牙恢复期"></div>' +
        rulesFormHTML(rules) +
        '<div class="modal-actions"><button class="btn btn-ghost" id="cp-cancel">取消</button>' +
        '<button class="btn btn-primary" id="cp-save">开始</button></div>',
    });
    bindRulesForm(m.el, rules);
    m.el.querySelector('#cp-cancel').onclick = function () { m.close(); };
    m.el.querySelector('#cp-save').onclick = function () {
      const name = m.el.querySelector('#cp-name').value.trim();
      if (!name) { ui.toast('请填写名称'); return; }
      db.addPeriod({
        templateId: 'custom', name: name, enabled: true,
        startedAt: new Date().toISOString(), endedAt: null, suggestedDays: null,
        rules: rules, notes: '',
      });
      m.close();
      ui.toast('已开启「' + name + '」');
    };
  }

  function openEditPeriod(p) {
    const rules = JSON.parse(JSON.stringify(p.rules || {}));
    ['forbidIngredients', 'forbidTags', 'forbidDishes', 'forbidShops', 'preferTags'].forEach(function (k) {
      if (!rules[k]) rules[k] = [];
    });
    const m = ui.openModal({
      title: '编辑规则：' + p.name,
      bodyHTML: rulesFormHTML(rules) +
        '<div class="modal-actions"><button class="btn btn-ghost" id="er-cancel">取消</button>' +
        '<button class="btn btn-primary" id="er-save">保存</button></div>',
    });
    bindRulesForm(m.el, rules);
    m.el.querySelector('#er-cancel').onclick = function () { m.close(); };
    m.el.querySelector('#er-save').onclick = function () {
      db.updatePeriod(p.id, { rules: rules });
      m.close();
      ui.toast('规则已更新');
    };
  }

  function periods(c) {
    const s = db.getState();
    const active = rec.getActivePeriods(s);
    const ended = s.specialPeriods.filter(function (p) { return !rec.isPeriodActive(p, Date.now()); });
    c.innerHTML =
      '<div class="periods">' +
      (active.length ? '<h2 class="sec-title">进行中</h2>' + active.map(function (p) { return periodCardHTML(p, true); }).join('') : '') +
      '<h2 class="sec-title">开启一个时期</h2>' +
      '<div class="tpl-grid">' +
        C.SPECIAL_PERIOD_TEMPLATES.map(function (t) {
          return '<button class="tpl-card" data-tpl="' + t.id + '"><span class="tpl-icon">' + t.icon + '</span>' +
            '<span class="tpl-name">' + t.name + '</span><span class="tpl-desc">' + t.desc + '</span></button>';
        }).join('') +
        '<button class="tpl-card custom" id="customPeriod"><span class="tpl-icon">✨</span>' +
          '<span class="tpl-name">自定义规则</span><span class="tpl-desc">按自己的情况配忌口</span></button>' +
      '</div>' +
      (ended.length ? '<details class="ended"><summary>已结束（' + ended.length + '）</summary>' +
        ended.map(function (p) { return periodCardHTML(p, false); }).join('') + '</details>' : '') +
      '<p class="disclaimer">' + C.DISCLAIMER + '</p>' +
      '</div>';

    c.querySelectorAll('[data-tpl]').forEach(function (b) {
      b.onclick = function () { startTemplate(b.dataset.tpl); };
    });
    c.querySelector('#customPeriod').onclick = openCustomPeriod;
    c.querySelectorAll('[data-edit-period]').forEach(function (b) {
      b.onclick = function () {
        const p = s.specialPeriods.find(function (x) { return x.id === b.dataset.editPeriod; });
        if (p) openEditPeriod(p);
      };
    });
    c.querySelectorAll('[data-end-period]').forEach(function (b) {
      b.onclick = async function () {
        const p = s.specialPeriods.find(function (x) { return x.id === b.dataset.endPeriod; });
        if (!p) return;
        const ok = await ui.confirm({ title: '结束「' + p.name + '」？', message: '结束后相关忌口规则不再生效。', okText: '结束' });
        if (ok) { db.endPeriod(p.id); ui.toast('已结束'); }
      };
    });
    c.querySelectorAll('[data-del-period]').forEach(function (b) {
      b.onclick = async function () {
        const ok = await ui.confirm({ title: '删除这条时期记录？', message: '删除后不可恢复。', okText: '删除', danger: true });
        if (ok) { db.deletePeriod(b.dataset.delPeriod); ui.toast('已删除'); }
      };
    });
  }

  /* ============================================================
   * 我的 / 偏好 / 历史 / 踩雷 / 数据
   * ============================================================ */
  function settings(c) {
    c.innerHTML =
      '<div class="settings">' +
      '<div class="menu">' +
        '<a class="menu-item" href="#/preferences"><span>🥘</span><span>偏好与忌口</span><span class="arrow">›</span></a>' +
        '<a class="menu-item" href="#/history"><span>📅</span><span>用餐历史</span><span class="arrow">›</span></a>' +
        '<a class="menu-item" href="#/pitfalls"><span>💣</span><span>踩雷记录</span><span class="arrow">›</span></a>' +
        '<a class="menu-item" href="#/data"><span>💾</span><span>数据备份</span><span class="arrow">›</span></a>' +
        '<button class="menu-item" id="seedBtn"><span>🧪</span><span>载入演示数据</span><span class="arrow">›</span></button>' +
      '</div>' +
      '<details class="card" style="margin-top:12px"><summary style="cursor:pointer;font-size:14px">ℹ️ 关于与免责声明</summary>' +
        '<p style="font-size:12px;color:var(--muted);margin-top:8px;line-height:1.8">' +
        '「今天吃什么」根据你记录的口味、库存、特殊时期和身体反馈，帮你决定下一顿。<br>' +
        '数据保存在本机浏览器 localStorage 中，不会上传。<br><br>' + C.DISCLAIMER + '</p>' +
      '</details>' +
      '</div>';
    c.querySelector('#seedBtn').onclick = async function () {
      const ok = await ui.confirm({ title: '载入演示数据', message: '会用示例数据覆盖当前全部数据，用来体验推荐功能。确定吗？', okText: '载入', danger: true });
      if (ok) { db.seedDemoData(); ui.toast('已载入演示数据'); location.hash = '#/home'; }
    };
  }

  function preferences(c) {
    const s = db.getState();
    const p = s.preferences;
    const ingKnown = unique([].concat(
      s.dishes.reduce(function (a, x) { return a.concat(x.ingredients || []); }, []),
      s.inventory.map(function (x) { return x.name; })
    ));
    c.innerHTML =
      '<div class="prefs">' +
      '<div class="form-row"><label>过敏食材（推荐时硬性排除）</label><div id="pf-allergies"></div></div>' +
      '<div class="form-row"><label>讨厌的食材（硬性排除）</label><div id="pf-disliked"></div></div>' +
      '<div class="form-row"><label>忌口标签（硬性排除，如：生冷）</label><div id="pf-tags"></div></div>' +
      '<div class="form-row"><label>辣度上限</label><select class="select" id="pf-maxspicy">' +
        '<option value=""' + (p.maxSpicy == null ? ' selected' : '') + '>不限制</option>' +
        [1, 2, 3, 4, 5].map(function (v) {
          return '<option value="' + v + '"' + (p.maxSpicy === v ? ' selected' : '') + '>' + C.TASTE_SCALES.spicy.levels[v] + '及以下</option>';
        }).join('') +
      '</select></div>' +
      '<div class="form-row"><label>偏好辣度（软加分）</label><select class="select" id="pf-prefspicy">' +
        '<option value=""' + (p.preferredSpicy == null ? ' selected' : '') + '>不设置</option>' +
        [1, 2, 3, 4, 5].map(function (v) {
          return '<option value="' + v + '"' + (p.preferredSpicy === v ? ' selected' : '') + '>喜欢' + C.TASTE_SCALES.spicy.levels[v] + '</option>';
        }).join('') +
      '</select></div>' +
      '<div class="form-row"><label>默认可用时间（推荐打分用）</label><select class="select" id="pf-time">' +
        [15, 30, 45, 60, 90, 120].map(function (v) {
          return '<option value="' + v + '"' + (p.defaultAvailableTimeMin === v ? ' selected' : '') + '>' + v + ' 分钟</option>';
        }).join('') +
      '</select></div>' +
      '<p class="disclaimer">修改立即生效，下次推荐就会体现</p>' +
      '</div>';

    ui.bindChips(c.querySelector('#pf-allergies'), { values: p.allergies, suggestions: ingKnown, placeholder: '如：花生', onChange: function (v) { db.savePreferences({ allergies: v }); } });
    ui.bindChips(c.querySelector('#pf-disliked'), { values: p.dislikedIngredients, suggestions: ingKnown, placeholder: '如：香菜', onChange: function (v) { db.savePreferences({ dislikedIngredients: v }); } });
    ui.bindChips(c.querySelector('#pf-tags'), { values: p.dislikedTags, suggestions: C.TAG_SUGGESTIONS, onChange: function (v) { db.savePreferences({ dislikedTags: v }); } });
    c.querySelector('#pf-maxspicy').onchange = function (e) { db.savePreferences({ maxSpicy: e.target.value === '' ? null : Number(e.target.value) }); };
    c.querySelector('#pf-prefspicy').onchange = function (e) { db.savePreferences({ preferredSpicy: e.target.value === '' ? null : Number(e.target.value) }); };
    c.querySelector('#pf-time').onchange = function (e) { db.savePreferences({ defaultAvailableTimeMin: Number(e.target.value) }); };
  }

  function historyView(c) {
    const s = db.getState();
    const sorted = s.history.slice().sort(function (a, b) { return b.eatenAt.localeCompare(a.eatenAt); });
    if (!sorted.length) {
      c.innerHTML = '<div class="empty">还没有用餐记录<br>在推荐页右滑卡片，或在菜品详情点「吃过了」即可记录</div>';
      return;
    }
    const groups = [];
    let cur = null;
    sorted.forEach(function (h) {
      const day = ui.dayLabel(h.eatenAt);
      if (!cur || cur.label !== day) { cur = { label: day, items: [] }; groups.push(cur); }
      cur.items.push(h);
    });
    c.innerHTML = '<div class="history">' + groups.map(function (g) {
      return '<div class="day-title">' + g.label + '</div><div class="list">' + g.items.map(historyRowHTML).join('') + '</div>';
    }).join('') + '</div>';
    bindHistoryDelete(c);
  }

  function pitfallRowHTML(p) {
    return '<div class="row" style="cursor:default">' +
      '<div class="row-main"><div class="row-name">' +
        (p.severity === 'hard' ? '<span class="badge badge-danger">拉黑</span>' : '<span class="badge badge-t">提醒</span>') +
        ' ' + ui.esc(p.dishName) +
        (p.shop ? ' <span style="font-size:12px;color:var(--muted)">@' + ui.esc(p.shop) + '</span>' : '') + '</div>' +
      '<div class="row-sub">' + ui.esc(p.problem) + '</div></div>' +
      '<button class="h-del" data-del-p="' + p.id + '" aria-label="删除">🗑</button>' +
      '</div>';
  }

  function pitfalls(c) {
    const s = db.getState();
    c.innerHTML =
      '<div class="pitfalls">' +
      '<div class="card"><b style="font-size:14px">新增踩雷记录</b>' +
        '<div class="form-row" style="margin-top:10px"><input class="input" id="pt-shop" placeholder="店名（自制可不填）"></div>' +
        '<div class="form-row"><input class="input" id="pt-dish" placeholder="菜名 *"></div>' +
        '<div class="form-row"><select class="select" id="pt-link"><option value="">关联菜品（可选，关联后推荐会处理该菜）</option>' +
          s.dishes.filter(function (d) { return d.status === 'active'; }).map(function (d) {
            return '<option value="' + d.id + '">' + ui.esc(d.name) + '</option>';
          }).join('') +
        '</select></div>' +
        '<div class="form-row"><textarea id="pt-problem" rows="2" placeholder="出了什么问题？如：太咸，牛肉嚼不动"></textarea></div>' +
        '<div class="form-row"><div class="seg" id="pt-sev">' +
          '<button type="button" data-sev="soft" class="on">提醒（推荐时标注）</button>' +
          '<button type="button" data-sev="hard">拉黑（不再推荐）</button></div></div>' +
        '<button class="btn btn-primary" id="pt-add" style="width:100%">添加记录</button>' +
      '</div>' +
      (s.pitfalls.length
        ? '<div class="list">' + s.pitfalls.slice().sort(function (a, b) { return b.createdAt.localeCompare(a.createdAt); }).map(pitfallRowHTML).join('') + '</div>'
        : '<div class="empty">还没有踩雷记录</div>') +
      '</div>';

    let sev = 'soft';
    c.querySelectorAll('#pt-sev button').forEach(function (b) {
      b.onclick = function () {
        sev = b.dataset.sev;
        c.querySelectorAll('#pt-sev button').forEach(function (x) { x.classList.toggle('on', x === b); });
      };
    });
    c.querySelector('#pt-add').onclick = function () {
      const dishName = c.querySelector('#pt-dish').value.trim();
      if (!dishName) { ui.toast('请填写菜名'); return; }
      const problem = c.querySelector('#pt-problem').value.trim();
      if (!problem) { ui.toast('请填写踩雷原因'); return; }
      db.addPitfall({
        shop: c.querySelector('#pt-shop').value.trim(),
        dishName: dishName,
        dishId: c.querySelector('#pt-link').value || null,
        problem: problem,
        severity: sev,
      });
      ui.toast('已记录');
    };
    c.querySelectorAll('[data-del-p]').forEach(function (b) {
      b.onclick = async function (e) {
        e.stopPropagation();
        const ok = await ui.confirm({ title: '删除这条踩雷记录？', okText: '删除', danger: true });
        if (ok) { db.deletePitfall(b.dataset.delP); ui.toast('已删除'); }
      };
    });
  }

  function dataPage(c) {
    const s = db.getState();
    c.innerHTML =
      '<div class="data">' +
      '<div class="card">' +
        '<div class="stat-line">' + s.dishes.length + ' 道菜 · ' + s.inventory.length + ' 种食材 · ' +
          s.history.length + ' 条记录 · ' + s.pitfalls.length + ' 条踩雷</div>' +
        '<div class="data-actions">' +
          '<button class="btn btn-primary" id="dt-export">📤 导出备份（下载 JSON）</button>' +
          '<button class="btn btn-ghost" id="dt-import">📥 导入备份（覆盖当前数据）</button>' +
          '<button class="btn btn-ghost" id="dt-seed">🧪 载入演示数据</button>' +
          '<button class="btn btn-danger" id="dt-clear">🗑 清空所有数据</button>' +
        '</div>' +
        '<input type="file" id="dt-file" accept=".json,application/json" style="display:none">' +
      '</div>' +
      '<p class="disclaimer">数据保存在本机浏览器中，不会上传。清除浏览器数据会丢失记录，请定期导出备份。<br>换设备可通过导出 / 导入同步。</p>' +
      '</div>';

    c.querySelector('#dt-export').onclick = function () {
      const blob = new Blob([db.exportData()], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      const d = new Date();
      a.download = 'what2eat-backup-' + d.getFullYear() + '-' +
        String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0') + '.json';
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
      ui.toast('已导出');
    };
    c.querySelector('#dt-import').onclick = function () { c.querySelector('#dt-file').click(); };
    c.querySelector('#dt-file').onchange = async function (e) {
      const file = e.target.files[0];
      if (!file) return;
      const text = await file.text();
      const ok = await ui.confirm({ title: '导入备份？', message: '会用备份内容覆盖当前全部数据，建议先导出当前数据。', okText: '导入' });
      if (!ok) { e.target.value = ''; return; }
      const r = db.importData(text);
      if (r.ok) ui.toast('导入成功');
      else ui.toast(r.error, 'err');
      e.target.value = '';
    };
    c.querySelector('#dt-seed').onclick = async function () {
      const ok = await ui.confirm({ title: '载入演示数据', message: '会用示例数据覆盖当前全部数据，用来体验推荐功能。确定吗？', okText: '载入', danger: true });
      if (ok) { db.seedDemoData(); ui.toast('已载入演示数据'); location.hash = '#/home'; }
    };
    c.querySelector('#dt-clear').onclick = async function () {
      const ok1 = await ui.confirm({ title: '清空所有数据？', message: '会删除全部菜品、库存、时期、历史和踩雷记录，无法恢复。建议先导出备份。', okText: '继续', danger: true });
      if (!ok1) return;
      const ok2 = await ui.confirm({ title: '最后确认', message: '真的要清空吗？', okText: '清空', danger: true });
      if (ok2) { db.clearAll(); ui.toast('已清空'); location.hash = '#/home'; }
    };
  }

  /* ============================================================
   * 快捷添加（冷启动引导）
   * ============================================================ */
  function qaCardHTML(p, i) {
    return '<button class="qa-card" data-k="' + i + '"><div>' +
      '<div class="qa-name">' + ui.esc(p.name) + '</div>' +
      '<div class="qa-sub">' + ui.esc(p.source === 'takeout'
        ? (p.takeoutShop || '')
        : ((p.tags || []).join(' · ') + (p.cookTimeMin ? ' · ' + p.cookTimeMin + '分钟' : ''))) +
      '</div></div><span class="qa-check">✓</span></button>';
  }

  function quickadd(c) {
    const presets = C.QUICK_ADD_PRESETS;
    const selected = new Set();
    const render = function () {
      const takeout = presets.map(function (p, i) { return { p: p, i: i }; }).filter(function (x) { return x.p.source === 'takeout'; });
      const homemade = presets.map(function (p, i) { return { p: p, i: i }; }).filter(function (x) { return x.p.source === 'homemade'; });
      c.innerHTML =
        '<div class="quickadd">' +
        '<div class="card" style="font-size:13px;color:var(--muted)">勾选你常吃的，一键加入菜品库。标签、口味、时间已预填，之后可随时编辑。</div>' +
        '<div class="qa-section-title">🛵 外卖</div>' + takeout.map(function (x) { return qaCardHTML(x.p, x.i); }).join('') +
        '<div class="qa-section-title">🍳 自制</div>' + homemade.map(function (x) { return qaCardHTML(x.p, x.i); }).join('') +
        '<div class="qa-bottom"><button class="btn btn-primary btn-big" id="qa-save">添加所选（' + selected.size + '）</button></div>' +
        '</div>';

      c.querySelectorAll('.qa-card').forEach(function (b) {
        b.onclick = function () {
          const k = Number(b.dataset.k);
          if (selected.has(k)) selected.delete(k); else selected.add(k);
          b.classList.toggle('on', selected.has(k));
          c.querySelector('#qa-save').textContent = '添加所选（' + selected.size + '）';
        };
      });
      c.querySelector('#qa-save').onclick = function () {
        if (!selected.size) { ui.toast('先勾选几道菜'); return; }
        let n = 0;
        presets.forEach(function (p, i) {
          if (!selected.has(i)) return;
          db.addDish({
            name: p.name, source: p.source, takeoutShop: p.takeoutShop || '',
            category: p.category, tags: (p.tags || []).slice(),
            taste: Object.assign({ spicy: 0, salty: 0, sweet: 0, sour: 0, texture: '', temp: 'hot' }, p.taste || {}),
            ingredients: (p.ingredients || []).slice(), cookTimeMin: p.cookTimeMin || 0,
            rating: 0, loved: false,
          });
          n++;
        });
        db.setOnboarded();
        ui.toast('已添加 ' + n + ' 道菜');
        location.hash = '#/home';
      };
    };
    render();
  }

  W2E.views = {
    home: home,
    dishes: dishes,
    dishForm: dishForm,
    dishDetail: dishDetail,
    inventory: inventory,
    periods: periods,
    settings: settings,
    preferences: preferences,
    historyView: historyView,
    pitfalls: pitfalls,
    dataPage: dataPage,
    quickadd: quickadd,
    openRecordMeal: openRecordMeal,
  };
})();
