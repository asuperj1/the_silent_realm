// 读取环境变量并导出配置常量
require('dotenv').config();

module.exports = {
  PORT: process.env.PORT || 3000,
  DEEPSEEK_API_KEY: process.env.DEEPSEEK_API_KEY,
  AI_BASE_URL: process.env.AI_BASE_URL || 'https://api.deepseek.com/v1/chat/completions',
  AI_TIMEOUT: Number(process.env.AI_TIMEOUT) || 15000,
  MAX_CONTEXT_LENGTH: Number(process.env.MAX_CONTEXT_LENGTH) || 20,
  TOKEN_ALERT_THRESHOLD: Number(process.env.TOKEN_ALERT_THRESHOLD) || 8000,
  TOKEN_BREAK_THRESHOLD: Number(process.env.TOKEN_BREAK_THRESHOLD) || 10000,
  DISCONNECT_TIMEOUT: Number(process.env.DISCONNECT_TIMEOUT) || 15 * 60 * 1000,
  SAVE_DIR: './saves',
  RESOURCE_JSON: './resource.json',
  ASSETS_DIR: './assets'
};