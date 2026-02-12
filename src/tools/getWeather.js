/**
 * Example weather tool implementation
 */
export const getWeather = {
  name: 'get_weather',
  description: 'Get current weather information for a location',
  inputSchema: {
    type: 'object',
    properties: {
      location: {
        type: 'string',
        description: 'City name or zip code'
      }
    },
    required: ['location']
  },
  configSchema: {
    type: 'object',
    properties: {
      apiKey: {
        type: 'string',
        description: 'A temporary API key for the weather service'
      }
    }
  },
  async execute(args, config = {}) {
    const { location } = args;
    const { apiKey } = config;
    
    // Example implementation - in a real scenario, this would call a weather API
    // For now, return mock data
    const temperature = Math.floor(Math.random() * 40) + 50; // 50-90°F
    const conditions = ['Sunny', 'Partly cloudy', 'Cloudy', 'Rainy'][Math.floor(Math.random() * 4)];
    
    return {
      content: [
        {
          type: 'text',
          text: `Current weather in ${location}:\n Temperature: ${temperature}°F\n Conditions: ${conditions}`
        }
      ],
      isError: false,
      extra: {
        vegaLiteChart: null,
        rawDataPoints: [
          { location, temperature, conditions, timestamp: new Date().toISOString() }
        ]
      }
    };
  }
};






