/* ============================================================
 * recommend.js — 推荐算法（纯函数，不碰 DOM / localStorage）
 * 四步：规则合并 → 硬约束过滤 → 软偏好打分 → 选 3 + 换一批去重
 * 可在 DevTools console 直接调用测试：
 *   W2E.rec.recommend(W2E.db.getState(), {availableTimeMin: 30})
 * ============================================================ */
window.W2E = window.W2E || {};

(function () {
  'use strict';

  const DAY = 86400000;

  /* ---------- 时期生效判断 ---------- */

  function isPeriodActive(p, now) {
    if (!p || !p.enabled) return false;
    if (p.startedAt && new Date(p.startedAt).getTime() > now) return false;
    if (p.endedAt && new Date(p.endedAt).getTime() <= now) return false;
    return true;
  }

  function getActivePeriods(state, now) {
    now = now || Date.now();
    return (state.specialPeriods || []).filter(function (p) { return isPeriodActive(p, now); });
  }

  /* ---------- 派生统计（不落库，从 history 现算） ---------- */

  function deriveStats(state, now) {
    now = now || Date.now();
    const stats = {};
    (state.history || []).forEach(function (h) {
      if (!h.dishId) return;
      const t = new Date(h.eatenAt).getTime();
      if (isNaN(t)) return;
      let st = stats[h.dishId];
      if (!st) st = stats[h.dishId] = { eatCount: 0, lastEatenAt: 0, recentIssues: [], allergy90d: 0 };
      st.eatCount++;
      if (t > st.lastEatenAt) st.lastEatenAt = t;
      const issues = ((h.feedback && h.feedback.bodyIssues) || []).filter(function (x) { return x && x !== '无不适'; });
      if (issues.length && now - t < 30 * DAY) {
        issues.forEach(function (i) { if (st.recentIssues.indexOf(i) < 0) st.recentIssues.push(i); });
      }
      if (issues.indexOf('过敏') >= 0 && now - t < 90 * DAY) st.allergy90d++;
    });
    return stats;
  }

  /* ---------- 1. 规则合并：个人偏好 ∪ 所有生效时期 ---------- */

  function computeActiveRules(state, options, now) {
    options = options || {};
    now = now || Date.now();
    const prefs = state.preferences || {};
    const activePeriods = getActivePeriods(state, now);

    const rules = {
      activePeriods: activePeriods,
      allergyIngredients: new Set(prefs.allergies || []),
      dislikedIngredients: new Set(prefs.dislikedIngredients || []),
      personalForbidTags: new Set(prefs.dislikedTags || []),
      periodForbidTags: new Map(),        // tag -> 时期名
      periodForbidIngredients: new Map(), // 食材 -> 时期名
      forbidDishes: new Map(),            // 菜品 id -> 时期名
      forbidShops: new Map(),             // 店名 -> 时期名
      maxSpicy: prefs.maxSpicy || null,
      requireCooked: false,
      requireCookedPeriod: null,
      preferTags: new Set(),
    };

    activePeriods.forEach(function (p) {
      const r = p.rules || {};
      (r.forbidTags || []).forEach(function (t) { rules.periodForbidTags.set(t, p.name); });
      (r.forbidIngredients || []).forEach(function (i) { rules.periodForbidIngredients.set(i, p.name); });
      (r.forbidDishes || []).forEach(function (d) { rules.forbidDishes.set(d, p.name); });
      (r.forbidShops || []).forEach(function (s) { rules.forbidShops.set(s, p.name); });
      (r.preferTags || []).forEach(function (t) { rules.preferTags.add(t); });
      if (r.maxSpicy != null && (rules.maxSpicy == null || r.maxSpicy < rules.maxSpicy)) rules.maxSpicy = r.maxSpicy;
      if (r.requireCooked) { rules.requireCooked = true; rules.requireCookedPeriod = p.name; }
    });

    (options.preferTags || []).forEach(function (t) { rules.preferTags.add(t); });

    return rules;
  }

  /* ---------- 2. 硬约束过滤：固定顺序，返回首个失败原因 ---------- */

  function hardFilterReason(dish, ctx) {
    const rules = ctx.rules;
    const st = ctx.stats[dish.id];

    if (dish.status && dish.status !== 'active') return '已归档';
    if (dish.banned) return '已拉黑' + (dish.banReason ? '：' + dish.banReason : '');

    const hardPit = (ctx.state.pitfalls || []).find(function (p) {
      return p.severity === 'hard' && p.dishId === dish.id;
    });
    if (hardPit) return '踩雷记录：' + hardPit.problem;

    if (rules.forbidDishes.has(dish.id)) return '特殊时期「' + rules.forbidDishes.get(dish.id) + '」忌口';
    if (dish.takeoutShop && rules.forbidShops.has(dish.takeoutShop)) {
      return '特殊时期「' + rules.forbidShops.get(dish.takeoutShop) + '」忌口店铺';
    }

    const ings = dish.ingredients || [];
    for (let i = 0; i < ings.length; i++) {
      const ing = ings[i];
      if (rules.allergyIngredients.has(ing)) return '过敏：' + ing;
      if (rules.dislikedIngredients.has(ing)) return '你不爱吃：' + ing;
      if (rules.periodForbidIngredients.has(ing)) return '特殊时期「' + rules.periodForbidIngredients.get(ing) + '」忌口：' + ing;
    }

    const tags = dish.tags || [];
    for (let i = 0; i < tags.length; i++) {
      const t = tags[i];
      if (rules.personalForbidTags.has(t)) return '你的忌口标签：' + t;
      if (rules.periodForbidTags.has(t)) return '特殊时期「' + rules.periodForbidTags.get(t) + '」忌口：' + t;
    }

    const spicy = (dish.taste && dish.taste.spicy) || 0;
    if (rules.maxSpicy != null && spicy > rules.maxSpicy) return '辣度 ' + spicy + ' 超过上限 ' + rules.maxSpicy;

    if (rules.requireCooked && dish.source !== 'homemade') {
      return '特殊时期「' + rules.requireCookedPeriod + '」建议吃自己做的';
    }

    if (st && st.allergy90d >= 2) return '吃过疑似过敏（' + st.allergy90d + ' 次）';

    return null;
  }

  /* ---------- 3. 软偏好打分 ---------- */

  function scoreDish(dish, ctx) {
    const prefs = ctx.state.preferences || {};
    const rules = ctx.rules;
    const st = ctx.stats[dish.id];
    const t = dish.taste || {};
    let s = 0;

    // 评分：1-5 直接进总分，未评分记 3（中性，不惩罚冷启动数据）
    s += dish.rating > 0 ? dish.rating : 3;

    // 爱吃标签
    if (dish.loved) s += 2;

    // 近期吃过降权（从 history 现算）
    if (st && st.lastEatenAt) {
      const d = (ctx.now - st.lastEatenAt) / DAY;
      s -= d <= 1 ? 4 : d <= 3 ? 2.5 : d <= 7 ? 1 : 0;
    }

    // 口味匹配：偏好辣度 vs 菜品辣度（双方都设置才参与）
    if (prefs.preferredSpicy > 0 && t.spicy > 0) {
      s += Math.max(0, 1.5 - Math.abs(t.spicy - prefs.preferredSpicy) * 0.5);
    }

    // 特殊时期/场景偏好标签软加分
    const tagHits = (dish.tags || []).filter(function (x) { return rules.preferTags.has(x); });
    s += Math.min(1.5, tagHits.length * 0.5);

    const ings = dish.ingredients || [];
    if (dish.source === 'homemade') {
      // 库存匹配：齐全 +5（最大单项，决策痛点）/ ≥60% +3 / 部分 +1 / 全缺 -1
      if (ings.length > 0) {
        const hitCount = ings.filter(function (x) { return ctx.invNames.has(x); }).length;
        const m = hitCount / ings.length;
        s += m === 1 ? 5 : m >= 0.6 ? 3 : m > 0 ? 1 : -1;
      }
      // 时间匹配：来得及 +3 / 略超 0 / 明显超时 -2
      const ct = dish.cookTimeMin || 0;
      if (ct > 0) {
        if (ct <= ctx.availableTimeMin) s += 3;
        else if (ct <= ctx.availableTimeMin + 15) s += 0;
        else s -= 2;
      }
    } else {
      // 外卖：场景「今天很累」加成；平时给"不用做"的便利基数
      s += ctx.options.preferTakeout ? 2.5 : 0.5;
    }

    // 近 30 天身体反馈问题惩罚（每个 -2，封顶 -5）
    if (st && st.recentIssues.length) s -= Math.min(5, st.recentIssues.length * 2);

    // 平局抖动：仅打破平局，不改变实质排序
    if (!ctx.options.noJitter) s += (Math.random() - 0.5) * 0.4;

    return Math.round(s * 100) / 100;
  }

  /* ---------- 理由与警告（卡片文案） ---------- */

  function buildReasons(dish, ctx) {
    const positives = [];
    const warnings = [];
    const prefs = ctx.state.preferences || {};
    const rules = ctx.rules;
    const st = ctx.stats[dish.id];
    const t = dish.taste || {};

    if (dish.rating >= 4) positives.push('你评了 ' + dish.rating + ' 星');
    if (dish.loved) positives.push('标记了爱吃');

    const ings = dish.ingredients || [];
    if (dish.source === 'homemade' && ings.length > 0) {
      const hits = ings.filter(function (x) { return ctx.invNames.has(x); });
      const miss = ings.filter(function (x) { return !ctx.invNames.has(x); });
      const m = hits.length / ings.length;
      if (m === 1) positives.push('家里食材齐全：' + hits.join('、'));
      else if (m >= 0.6) positives.push('家里有 ' + hits.join('、') + '（缺 ' + miss.join('、') + '）');
      else if (m > 0) positives.push('家里有 ' + hits.join('、'));
      else warnings.push('食材都要现买：' + miss.join('、'));
    }
    if (dish.source === 'homemade' && dish.cookTimeMin > 0) {
      if (dish.cookTimeMin <= ctx.availableTimeMin) positives.push(dish.cookTimeMin + ' 分钟能做好，来得及');
      else if (dish.cookTimeMin > ctx.availableTimeMin + 15) warnings.push(dish.cookTimeMin + ' 分钟，来不及');
    }
    if (dish.source === 'takeout' && ctx.options.preferTakeout) positives.push('今天很累，点外卖省事');

    const tagHits = (dish.tags || []).filter(function (x) { return rules.preferTags.has(x); });
    if (tagHits.length) positives.push('符合特殊时期偏好：' + tagHits.join('、'));

    if (prefs.preferredSpicy > 0 && t.spicy > 0 &&
        Math.max(0, 1.5 - Math.abs(t.spicy - prefs.preferredSpicy) * 0.5) >= 1) {
      positives.push('辣度合你口味');
    }

    if (st) {
      if (st.lastEatenAt && (ctx.now - st.lastEatenAt) / DAY <= 1) warnings.push('最近刚吃过');
      if (st.recentIssues.length) warnings.push('上次吃有点' + st.recentIssues.join('、'));
      else if (st.allergy90d === 1) warnings.push('曾吃过疑似过敏（1 次）');
    }

    const softPit = (ctx.state.pitfalls || []).find(function (p) {
      return p.severity === 'soft' && p.dishId === dish.id;
    });
    if (softPit) warnings.push('踩过雷：' + softPit.problem);

    const shopPit = (ctx.state.pitfalls || []).find(function (p) {
      return p.severity === 'soft' && !p.dishId && dish.source === 'takeout' &&
             p.shop && p.shop === dish.takeoutShop && p.dishName && p.dishName === dish.name;
    });
    if (shopPit) warnings.push('踩过雷：' + shopPit.problem);

    return { positives: positives.slice(0, 2), warnings: warnings.slice(0, 1) };
  }

  /* ---------- 换一批去重：近两批推荐 id 并集 ---------- */

  function buildExcludeIds(state) {
    const ids = [];
    ((state.meta && state.meta.lastBatches) || []).slice(-2).forEach(function (b) {
      (b || []).forEach(function (id) { ids.push(id); });
    });
    return ids;
  }

  /* ---------- 规则摘要（页面横幅显示用） ---------- */

  function summarizeRules(rules) {
    const tags = [];
    rules.personalForbidTags.forEach(function (t) { tags.push(t); });
    rules.periodForbidTags.forEach(function (v, t) { tags.push(t); });
    return {
      activePeriods: rules.activePeriods.map(function (p) { return p.name; }),
      forbidTags: Array.from(new Set(tags)),
      forbidIngredients: Array.from(new Set([].concat(
        Array.from(rules.allergyIngredients), Array.from(rules.dislikedIngredients),
        Array.from(rules.periodForbidIngredients.keys())
      ))),
      maxSpicy: rules.maxSpicy,
      requireCooked: rules.requireCooked,
    };
  }

  /* ---------- 入口 ---------- */

  function recommend(state, options) {
    options = options || {};
    const now = Date.now();
    const ctx = {
      state: state,
      options: options,
      now: now,
      stats: deriveStats(state, now),
      rules: computeActiveRules(state, options, now),
      invNames: new Set((state.inventory || []).map(function (i) { return i.name; })),
      availableTimeMin: options.availableTimeMin != null ? options.availableTimeMin
        : ((state.preferences || {}).defaultAvailableTimeMin || 60),
    };

    // 2. 硬过滤
    const filtered = [];
    const excluded = [];
    (state.dishes || []).forEach(function (dish) {
      const reason = hardFilterReason(dish, ctx);
      if (reason) excluded.push({ dish: dish, reason: reason });
      else filtered.push({ dish: dish, score: scoreDish(dish, ctx) });
    });

    // 4. 选 3 + 换一批去重
    const excludeIds = new Set(options.excludeIds || []);
    let pool = filtered.filter(function (f) { return !excludeIds.has(f.dish.id); });
    let relaxed = false;
    if (pool.length < 3 && filtered.length >= 3) { pool = filtered; relaxed = true; }

    pool.sort(function (a, b) { return b.score - a.score; });
    let batch = pool.slice(0, 3);

    // 多样性：与前面更高分的菜同分类则 -1.5
    for (let i = 0; i < batch.length; i++) {
      const b = batch[i];
      const dup = batch.slice(0, i).some(function (x) {
        return b.dish.category && x.dish.category === b.dish.category;
      });
      b.eff = dup ? b.score - 1.5 : b.score;
    }
    batch.sort(function (a, b) { return b.eff - a.eff; });

    // 来源混合保障：池子两种来源都有且无时期强制时，避免 3 个全是同一来源
    if (pool.length >= 3 && !ctx.rules.requireCooked) {
      const srcs = new Set(pool.map(function (p) { return p.dish.source; }));
      if (srcs.size === 2) {
        const bsrcs = new Set(batch.map(function (b) { return b.dish.source; }));
        if (bsrcs.size === 1) {
          const other = batch[0].dish.source === 'homemade' ? 'takeout' : 'homemade';
          const alt = pool.filter(function (p) {
            return p.dish.source === other && batch.indexOf(p) < 0;
          }).sort(function (a, b) { return b.score - a.score; })[0];
          if (alt && alt.score > 0) {
            batch[batch.length - 1] = alt;
            batch.sort(function (a, b) {
              const ae = a.eff != null ? a.eff : a.score;
              const be = b.eff != null ? b.eff : b.score;
              return be - ae;
            });
          }
        }
      }
    }

    // 5. 理由
    const result = batch.map(function (b) {
      return { dish: b.dish, score: b.score, reasons: buildReasons(b.dish, ctx) };
    });

    return {
      batch: result,
      excluded: excluded,
      appliedRules: summarizeRules(ctx.rules),
      relaxed: relaxed,
    };
  }

  W2E.rec = {
    recommend: recommend,
    deriveStats: deriveStats,
    computeActiveRules: computeActiveRules,
    hardFilterReason: hardFilterReason,
    scoreDish: scoreDish,
    buildReasons: buildReasons,
    buildExcludeIds: buildExcludeIds,
    isPeriodActive: isPeriodActive,
    getActivePeriods: getActivePeriods,
  };
})();
