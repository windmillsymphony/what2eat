/* ============================================================
 * data.js — 常量与预设：口味枚举、身体反馈、特殊时期模板、
 * 快捷菜库、免责声明
 * ============================================================ */
window.W2E = window.W2E || {};

(function () {
  'use strict';

  W2E.consts = {
    // 标签建议词表（特殊时期规则匹配的桥梁，录入时引导使用）
    TAG_SUGGESTIONS: ['清淡', '辛辣', '油炸', '生冷', '热乎', '汤类', '烧烤', '油腻', '冰饮',
      '易消化', '快手', '下饭', '高蛋白', '甜点', '主食', '小吃', '粥类', '下酒'],

    DISH_CATEGORIES: ['家常菜', '面食', '米饭', '汤粥', '快餐', '小吃', '火锅', '烧烤', '甜点', '饮品', '其他'],

    INVENTORY_CATEGORIES: ['蔬菜', '肉蛋', '主食', '调料', '奶制品', '水果', '其他'],

    TEXTURE_OPTIONS: ['软烂', '适中', '脆爽', '筋道', '嫩滑', '酥脆'],

    TEMP_OPTIONS: { hot: '热食', cold: '冷食', room: '常温' },

    // 口味滑条：0 = 未设置
    TASTE_SCALES: {
      spicy: { label: '辣度', levels: ['未设置', '不辣', '微辣', '中辣', '辣', '变态辣'] },
      salty: { label: '咸淡', levels: ['未设置', '清淡', '偏淡', '适中', '偏咸', '重口'] },
      sweet: { label: '甜度', levels: ['未设置', '不甜', '微甜', '适中', '偏甜', '很甜'] },
      sour:  { label: '酸度', levels: ['未设置', '不酸', '微酸', '适中', '偏酸', '很酸'] },
    },

    // 吃完后的身体反馈（推荐打分与硬拦截的依据）
    BODY_ISSUE_OPTIONS: ['无不适', '胀气', '上火', '过敏', '胃疼', '拉肚子', '反酸', '嗓子疼'],

    // 特殊时期模板：启动时把规则快照拷贝进实例，可再编辑
    SPECIAL_PERIOD_TEMPLATES: [
      {
        id: 'cold', name: '感冒了', icon: '🤧', desc: '发烧流涕时清淡饮食', suggestedDays: 7,
        rules: {
          forbidIngredients: ['海鲜', '酒', '酒精'],
          forbidTags: ['辛辣', '油炸', '生冷', '烧烤'],
          forbidDishes: [], forbidShops: [],
          maxSpicy: 1, preferTags: ['清淡', '热乎', '汤类'], requireCooked: true,
        },
        notes: '多喝水、清淡饮食，注意休息',
      },
      {
        id: 'gastro', name: '肠胃炎', icon: '🤢', desc: '腹泻呕吐期少渣饮食', suggestedDays: 5,
        rules: {
          forbidIngredients: ['海鲜', '牛奶', '豆浆', '酒', '酒精'],
          forbidTags: ['辛辣', '油炸', '生冷', '油腻', '烧烤'],
          forbidDishes: [], forbidShops: [],
          maxSpicy: 0, preferTags: ['清淡', '易消化', '粥类'], requireCooked: true,
        },
        notes: '急性期建议流食/半流食，症状持续请就医',
      },
      {
        id: 'menstrual', name: '月经期', icon: '🌸', desc: '这几天注意保暖', suggestedDays: 7,
        rules: {
          forbidIngredients: [],
          forbidTags: ['生冷', '冰饮'],
          forbidDishes: [], forbidShops: [],
          maxSpicy: null, preferTags: ['热乎', '汤类'], requireCooked: false,
        },
        notes: '避免生冷，注意保暖，个体差异大按自己感受来',
      },
      {
        id: 'medication', name: '用药期间', icon: '💊', desc: '服药期间忌口提醒', suggestedDays: null,
        rules: {
          forbidIngredients: ['酒', '酒精'],
          forbidTags: [],
          forbidDishes: [], forbidShops: [],
          maxSpicy: null, preferTags: ['清淡'], requireCooked: false,
        },
        notes: '具体忌口请遵医嘱，忌酒为通用提醒',
      },
    ],

    DISCLAIMER: '以上饮食建议仅供参考，不构成医疗建议，请遵医嘱。',

    // 快捷录入预设菜库：外卖 8 + 自制 8，预填好标签/口味/食材/时间
    QUICK_ADD_PRESETS: [
      { name: '黄焖鸡米饭', source: 'takeout', takeoutShop: '黄焖鸡米饭店', category: '米饭', tags: ['下饭', '热乎'], taste: { spicy: 1 }, ingredients: [], cookTimeMin: 0 },
      { name: '麻辣烫', source: 'takeout', takeoutShop: '杨国福麻辣烫', category: '快餐', tags: ['辛辣', '油腻'], taste: { spicy: 4 }, ingredients: [], cookTimeMin: 0 },
      { name: '兰州拉面', source: 'takeout', takeoutShop: '兰州拉面馆', category: '面食', tags: ['热乎'], taste: { spicy: 0 }, ingredients: [], cookTimeMin: 0 },
      { name: '沙县拌面', source: 'takeout', takeoutShop: '沙县小吃', category: '面食', tags: ['快手'], taste: { spicy: 0 }, ingredients: [], cookTimeMin: 0 },
      { name: '汉堡', source: 'takeout', takeoutShop: '麦当劳', category: '快餐', tags: ['油炸'], taste: { spicy: 0 }, ingredients: [], cookTimeMin: 0 },
      { name: '披萨', source: 'takeout', takeoutShop: '必胜客', category: '快餐', tags: ['油腻'], taste: { spicy: 0 }, ingredients: [], cookTimeMin: 0 },
      { name: '皮蛋瘦肉粥（外卖）', source: 'takeout', takeoutShop: '粥铺', category: '汤粥', tags: ['清淡', '粥类', '易消化'], taste: { spicy: 0 }, ingredients: [], cookTimeMin: 0 },
      { name: '饺子（外卖）', source: 'takeout', takeoutShop: '饺子馆', category: '面食', tags: ['热乎'], taste: { spicy: 0 }, ingredients: [], cookTimeMin: 0 },
      { name: '番茄炒蛋', source: 'homemade', takeoutShop: '', category: '家常菜', tags: ['清淡', '快手', '下饭'], taste: { spicy: 0, salty: 2, sweet: 1, sour: 2 }, ingredients: ['西红柿', '鸡蛋'], cookTimeMin: 10 },
      { name: '蛋炒饭', source: 'homemade', takeoutShop: '', category: '米饭', tags: ['快手', '下饭'], taste: { spicy: 0, salty: 3 }, ingredients: ['米饭', '鸡蛋'], cookTimeMin: 10 },
      { name: '煮饺子', source: 'homemade', takeoutShop: '', category: '面食', tags: ['快手', '热乎'], taste: { spicy: 0, salty: 2 }, ingredients: ['速冻饺子'], cookTimeMin: 12 },
      { name: '番茄鸡蛋面', source: 'homemade', takeoutShop: '', category: '面食', tags: ['清淡', '热乎', '快手'], taste: { spicy: 0, salty: 1, sour: 1 }, ingredients: ['西红柿', '鸡蛋', '面条'], cookTimeMin: 15 },
      { name: '煮泡面', source: 'homemade', takeoutShop: '', category: '面食', tags: ['快手'], taste: { spicy: 0, salty: 4 }, ingredients: ['方便面', '鸡蛋'], cookTimeMin: 5 },
      { name: '蛋花汤', source: 'homemade', takeoutShop: '', category: '汤粥', tags: ['清淡', '汤类', '易消化'], taste: { spicy: 0, salty: 1 }, ingredients: ['鸡蛋', '葱花'], cookTimeMin: 8 },
      { name: '白粥', source: 'homemade', takeoutShop: '', category: '汤粥', tags: ['清淡', '粥类', '易消化'], taste: { spicy: 0, salty: 1 }, ingredients: ['大米'], cookTimeMin: 30 },
      { name: '炒青菜', source: 'homemade', takeoutShop: '', category: '家常菜', tags: ['清淡', '快手'], taste: { spicy: 0, salty: 2 }, ingredients: ['青菜', '蒜'], cookTimeMin: 8 },
    ],
  };
})();
