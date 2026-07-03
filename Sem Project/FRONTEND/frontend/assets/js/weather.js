(function () {
    const cityEl = document.getElementById('weatherCity');
    const tempEl = document.getElementById('weatherTemp');
    const descEl = document.getElementById('weatherDesc');
    const iconEl = document.getElementById('weatherIcon');
    const cityInput = document.getElementById('weatherCityInput');
    const searchForm = document.getElementById('weatherSearchForm');
    const searchBtn = document.getElementById('weatherSearchBtn');
    const weatherPanelClickable = document.getElementById('weatherPanelClickable');
    const weatherModal = document.getElementById('weatherModal');
    const closeWeatherModalBtn = document.getElementById('closeWeatherModal');

    if (!cityEl || !tempEl || !descEl || !iconEl) return;

    const WEATHER_CODE_MAP = {
        0: { text: 'Clear sky', icon: 'ri-sun-line' },
        1: { text: 'Mainly clear', icon: 'ri-sun-cloudy-line' },
        2: { text: 'Partly cloudy', icon: 'ri-cloudy-line' },
        3: { text: 'Overcast', icon: 'ri-cloudy-2-line' },
        45: { text: 'Foggy', icon: 'ri-mist-line' },
        48: { text: 'Foggy', icon: 'ri-mist-line' },
        51: { text: 'Light drizzle', icon: 'ri-drizzle-line' },
        53: { text: 'Drizzle', icon: 'ri-drizzle-line' },
        55: { text: 'Heavy drizzle', icon: 'ri-drizzle-line' },
        61: { text: 'Light rain', icon: 'ri-rainy-line' },
        63: { text: 'Rain', icon: 'ri-rainy-line' },
        65: { text: 'Heavy rain', icon: 'ri-rainy-line' },
        71: { text: 'Light snow', icon: 'ri-snowy-line' },
        73: { text: 'Snow', icon: 'ri-snowy-line' },
        75: { text: 'Heavy snow', icon: 'ri-snowy-line' },
        80: { text: 'Rain showers', icon: 'ri-showers-line' },
        81: { text: 'Rain showers', icon: 'ri-showers-line' },
        82: { text: 'Heavy showers', icon: 'ri-showers-line' },
        95: { text: 'Thunderstorm', icon: 'ri-thunderstorms-line' },
        96: { text: 'Thunderstorm', icon: 'ri-thunderstorms-line' },
        99: { text: 'Thunderstorm', icon: 'ri-thunderstorms-line' }
    };

    function setWeatherView(city, temperature, weatherCode) {
        const weatherMeta = WEATHER_CODE_MAP[weatherCode] || { text: 'Weather update', icon: 'ri-cloud-line' };
        cityEl.textContent = city;
        tempEl.textContent = `${Math.round(temperature)}°C`;
        descEl.textContent = weatherMeta.text;
        iconEl.className = `${weatherMeta.icon} weather-icon`;
    }

    function setLoadingState(label) {
        cityEl.textContent = label;
        tempEl.textContent = '--°C';
        descEl.textContent = 'Loading weather...';
        iconEl.className = 'ri-loader-4-line ri-spin weather-icon';
    }

    function setFallbackState(cityName) {
        cityEl.textContent = cityName || 'Mumbai';
        tempEl.textContent = '--°C';
        descEl.textContent = 'Weather unavailable';
        iconEl.className = 'ri-cloud-line weather-icon';
    }

    function setSearchButtonState(isLoading) {
        if (!searchBtn) return;
        searchBtn.disabled = isLoading;
        searchBtn.innerHTML = isLoading
            ? "<i class='ri-loader-4-line ri-spin'></i>"
            : "<i class='ri-search-line'></i>";
    }

    function openWeatherModal() {
        if (weatherModal) weatherModal.style.display = 'flex';
    }

    function closeWeatherModal() {
        if (weatherModal) weatherModal.style.display = 'none';
    }

    // Modal controls
    if (weatherPanelClickable) {
        weatherPanelClickable.addEventListener('click', openWeatherModal);
    }

    if (closeWeatherModalBtn) {
        closeWeatherModalBtn.addEventListener('click', closeWeatherModal);
    }

    if (weatherModal) {
        weatherModal.addEventListener('click', (e) => {
            if (e.target === weatherModal) closeWeatherModal();
        });
    }

    async function fetchWeatherByCoords(lat, lon) {
        const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,weather_code`;
        const response = await fetch(url);
        if (!response.ok) throw new Error('Weather API failed');

        const data = await response.json();
        const current = data && data.current;
        if (!current || typeof current.temperature_2m !== 'number') throw new Error('Invalid weather response');

        return current;
    }

    async function fetchCityName(lat, lon) {
        try {
            const geoUrl = `https://geocoding-api.open-meteo.com/v1/reverse?latitude=${lat}&longitude=${lon}&language=en`;
            const response = await fetch(geoUrl);
            if (!response.ok) return 'Your Location';

            const geo = await response.json();
            if (!geo || !Array.isArray(geo.results) || geo.results.length === 0) return 'Your Location';

            return geo.results[0].name || 'Your Location';
        } catch {
            return 'Your Location';
        }
    }

    async function geocodeCity(cityName) {
        const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(cityName)}&count=1&language=en&format=json`;
        const response = await fetch(url);
        if (!response.ok) throw new Error('Geocoding failed');

        const data = await response.json();
        if (!data || !Array.isArray(data.results) || data.results.length === 0) {
            throw new Error('City not found');
        }

        const result = data.results[0];
        return {
            latitude: result.latitude,
            longitude: result.longitude,
            name: result.name
        };
    }

    async function loadWeatherForCity(cityName) {
        const cleanCity = (cityName || '').trim();
        if (!cleanCity) return;

        setLoadingState(cleanCity);
        setSearchButtonState(true);

        try {
            const location = await geocodeCity(cleanCity);
            const weather = await fetchWeatherByCoords(location.latitude, location.longitude);
            setWeatherView(location.name, weather.temperature_2m, weather.weather_code);
        } catch {
            cityEl.textContent = cleanCity;
            tempEl.textContent = '--°C';
            descEl.textContent = 'City not found or weather unavailable';
            iconEl.className = 'ri-error-warning-line weather-icon';
        } finally {
            setSearchButtonState(false);
        }
    }

    async function loadDefaultWeather() {
        setLoadingState('Mumbai');
        try {
            const weather = await fetchWeatherByCoords(19.0760, 72.8777);
            setWeatherView('Mumbai', weather.temperature_2m, weather.weather_code);
        } catch {
            setFallbackState('Mumbai');
        }
    }

    if (searchForm) {
        searchForm.addEventListener('submit', (event) => {
            event.preventDefault();
            if (!cityInput) return;
            loadWeatherForCity(cityInput.value);
        });
    }

    if (!navigator.geolocation) {
        loadDefaultWeather();
        return;
    }

    setLoadingState('Detecting location...');
    navigator.geolocation.getCurrentPosition(async (position) => {
        try {
            const lat = position.coords.latitude;
            const lon = position.coords.longitude;
            const city = await fetchCityName(lat, lon);
            const weather = await fetchWeatherByCoords(lat, lon);
            setWeatherView(city, weather.temperature_2m, weather.weather_code);
        } catch {
            loadDefaultWeather();
        }
    }, () => {
        loadDefaultWeather();
    }, { enableHighAccuracy: false, timeout: 6000, maximumAge: 300000 });
})();
