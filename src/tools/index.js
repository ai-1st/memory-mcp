import { getWeather } from './getWeather.js';

/**
 * Registry of all available tools
 */
export const tools = [
  getWeather
];

/**
 * Get a tool by name
 */
export function getTool(name) {
  return tools.find(tool => tool.name === name);
}






