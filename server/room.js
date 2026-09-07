/**
 * 房间工具模块 —— 纯函数，供 socketHandler.js 调用
 * 
 * ⚠️ 本模块不维护独立房间状态。
 * 所有房间状态由 socketHandler.js 中的 hallRooms / gameRooms 统一管理。
 * 本模块仅提供纯工具函数（开场白生成、消息评分等）。
 */

const gameLogic = require('./gamelogic');
const deepseek = require('./deepseekClient');

/**
 * 根据消息内容动态更新副本评分
 * @param {Object} copyState - 副本状态 { scores: { clue, survival, sanity, contribution } }
 * @param {string} content - 玩家消息文本
 */
function applyCopyScoring(copyState, content) {
  if (!copyState || !content) return;
  if (content.includes('线索') || content.includes('发现')) {
    copyState.scores.clue = Math.min(30, (copyState.scores.clue || 0) + 5);
  }
  if (content.includes('躲闪') || content.includes('防御')) {
    copyState.scores.survival = Math.min(25, (copyState.scores.survival || 0) + 3);
  }
  if (content.includes('意志') || content.includes('抵抗')) {
    copyState.scores.sanity = Math.min(20, (copyState.scores.sanity || 0) + 2);
  }
}

/**
 * 匹配 AI 返回的标签到场景素材
 * @param {string[]} tags - AI 返回的场景标签
 * @returns {{ imgUrl: string|null, sceneDesc: string, tags: string[] }}
 */
function matchSceneImage(tags) {
  const result = { imgUrl: null, sceneDesc: '', tags: tags || [] };
  if (!tags || tags.length === 0) return result;

  const matchedScene = gameLogic.matchSceneByTags(tags);
  if (matchedScene) {
    result.imgUrl = matchedScene.bg || matchedScene.url;
    result.sceneDesc = matchedScene.description || '';
    result.tags = matchedScene.sceneTags || tags;
  } else {
    result.imgUrl = gameLogic.resourceManager.matchResource(tags);
  }
  return result;
}

module.exports = { applyCopyScoring, matchSceneImage };