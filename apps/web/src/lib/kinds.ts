/** What each kind of device is called on screen. The server's category ids are not words a person reads. */
export const KIND_PLURAL: Record<string, string> = {
	light: 'Lights', switch: 'Switches', fan: 'Fans', climate: 'Climate', lock: 'Locks', camera: 'Cameras', media: 'Media', sensor: 'Sensors', energy: 'Energy',
	cover: 'Blinds and doors', vacuum: 'Vacuums', humidifier: 'Humidifiers', valve: 'Valves', waterheater: 'Water heaters', siren: 'Sirens', alarm: 'Alarms', input: 'Controls', weather: 'Weather'
};
export const KIND_SINGULAR: Record<string, string> = {
	light: 'Light', switch: 'Plug', fan: 'Fan', climate: 'Climate', lock: 'Lock', camera: 'Camera', media: 'Media', sensor: 'Sensor', energy: 'Energy',
	cover: 'Blind or door', vacuum: 'Vacuum', humidifier: 'Humidifier', valve: 'Valve', waterheater: 'Water heater', siren: 'Siren', alarm: 'Alarm', input: 'Control', weather: 'Weather'
};

/** Home Assistant's weather states, as words. */
export const WEATHER: Record<string, string> = {
	'clear-night': 'Clear night', cloudy: 'Cloudy', exceptional: 'Unusual weather', fog: 'Foggy', hail: 'Hail', lightning: 'Thunder', 'lightning-rainy': 'Thunderstorm', partlycloudy: 'Partly cloudy',
	pouring: 'Heavy rain', rainy: 'Rain', snowy: 'Snow', 'snowy-rainy': 'Sleet', sunny: 'Sunny', windy: 'Windy', 'windy-variant': 'Windy and cloudy'
};
