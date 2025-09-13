/* global google, markerClusterer */
const state = {
    map: null,
    userMarker: null,
    placeMarkers: [],
    markerClusterer: null,
    placesService: null,
    autocomplete: null,
    directionsService: null,
    directionsRenderer: null,
    userLocation: null,
    lastResults: [],
    isOnline: navigator.onLine,
    currentCategoryType: null,
    miniTagLoaded: new Set(),
    placeIdToMarker: {}
  };
  
  window.addEventListener('online', () => updateOnlineStatus(true));
  window.addEventListener('offline', () => updateOnlineStatus(false));
  
  function updateOnlineStatus(isOnline) {
    state.isOnline = isOnline;
    const badge = document.getElementById('statusBadge');
    if (!badge) return;
    if (isOnline) {
      badge.textContent = 'Online';
      badge.className = 'text-sm px-3 py-1 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200';
    } else {
      badge.textContent = 'Offline';
      badge.className = 'text-sm px-3 py-1 rounded-full bg-amber-50 text-amber-700 border border-amber-200';
    }
  }
  
  // Dark mode removed
  
  export async function initMap() {
    updateOnlineStatus(navigator.onLine);
  
    // Default view: Delhi
    const defaultCenter = { lat: 28.6139, lng: 77.2090 };
  
    state.map = new google.maps.Map(document.getElementById('map'), {
      center: defaultCenter,
      zoom: 5,
      fullscreenControl: false,
      mapTypeControl: false,
      streetViewControl: false
    });
  
    state.placesService = new google.maps.places.PlacesService(state.map);
    state.directionsService = new google.maps.DirectionsService();
    state.directionsRenderer = new google.maps.DirectionsRenderer({ map: state.map, suppressMarkers: false });
  
    // **Initialize "Search this area" button**
    const searchAreaBtn = document.getElementById('searchAreaBtn');
    if (searchAreaBtn) {
      console.log('Search area button found and initialized');
      
      // Hide initially
      searchAreaBtn.classList.add('hidden');
  
      // Show button when user drags or zooms the map
      state.map.addListener('dragend', () => {
        console.log('Map dragged - showing search area button');
        searchAreaBtn.classList.remove('hidden');
      });
      state.map.addListener('zoom_changed', () => {
        console.log('Map zoomed - showing search area button');
        searchAreaBtn.classList.remove('hidden');
      });
  
      // Handle click
      searchAreaBtn.addEventListener('click', async () => {
        console.log('Search area button clicked');
        searchAreaBtn.classList.add('hidden'); // hide after click
        // Trigger search at current map center
        await findNearbyCafes(state.map.getCenter().toJSON(), state.currentCategoryType || undefined);
      });
    } else {
      console.warn('Search area button not found!');
    }
  
    bindUI();
    await locateUser();
    if (state.userLocation) {
      state.map.setCenter(state.userLocation);
    }
  
    // If offline, load last results
    if (!state.isOnline) {
      const cached = loadCachedResults();
      if (cached?.results?.length) {
        state.lastResults = cached.results;
        renderResults(cached.results, cached.userLocation || state.userLocation);
      }
      return;
    }
  
    // Initial nearby fetch
    await findNearbyCafes();
  }
  
  
  function bindUI() {
    // Setup Places Autocomplete on the search input for suggestions
    const input = document.getElementById('queryInput');
    if (input && google?.maps?.places?.Autocomplete) {
      state.autocomplete = new google.maps.places.Autocomplete(input, {
        fields: ['place_id', 'geometry', 'name', 'formatted_address', 'types']
      });
      state.autocomplete.bindTo('bounds', state.map);
      state.autocomplete.addListener('place_changed', () => {
        const place = state.autocomplete.getPlace();
        if (place && place.geometry && place.geometry.location) {
          const loc = place.geometry.location;
          try { state.map.setCenter(loc); state.map.setZoom(14); } catch {}
          // Run a search biased around the selected place
          findNearbyCafes(loc.toJSON());
        } else {
          // If no geometry, just run a keyword search
          findNearbyCafes();
        }
      });
    }
  
    document.getElementById('locateBtn')?.addEventListener('click', async () => {
      console.log('Use my location button clicked');
      const before = !!state.userLocation;
      await locateUser();
      if (state.userLocation) {
        console.log('Location updated:', state.userLocation);
        state.map.setCenter(state.userLocation);
        state.map.setZoom(13);
      } else {
        const msg = navigator.geolocation
          ? 'Unable to get your location. Please allow location access in your browser.'
          : 'Geolocation is not supported in this browser.';
        alert(msg);
      }
    });
  
    document.getElementById('nearbyBtn')?.addEventListener('click', async () => {
      await findNearbyCafes();
    });
  
    document.getElementById('searchBtn')?.addEventListener('click', async () => {
      await findNearbyCafes();
    });
  
    // Enter-to-search and debounce typing
    if (input) {
      let debounceTimer = null;
      input.addEventListener('keydown', e => {
        if (e.key === 'Enter') {
          e.preventDefault();
          findNearbyCafes();
        }
      });
      input.addEventListener('input', () => {
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => findNearbyCafes(), 600);
      });
    }
  
    // Category chips
    document.querySelectorAll('.cat-chip').forEach(btn => {
      btn.addEventListener('click', () => {
        const query = btn.getAttribute('data-query') || '';
        const type = btn.getAttribute('data-type') || '';
        const qInput = document.getElementById('queryInput');
        if (qInput) qInput.value = query;
        state.currentCategoryType = type || null;
        findNearbyCafes(undefined, state.currentCategoryType || undefined);
      });
    });
  
    ['priceFilter', 'ratingFilter', 'wifiFilter', 'openNowFilter', 'radiusFilter'].forEach(id => {
      document.getElementById(id)?.addEventListener('change', () => findNearbyCafes());
    });
  }
  
  function locateUser() {
    return new Promise(resolve => {
      if (!navigator.geolocation) {
        console.warn('Geolocation not supported');
        return resolve(null);
      }
      
      // Clear any existing user location and marker
      state.userLocation = null;
      if (state.userMarker) {
        state.userMarker.setMap(null);
        state.userMarker = null;
      }
      
      console.log('Requesting fresh location...');
      navigator.geolocation.getCurrentPosition(
        pos => {
          const coords = { lat: pos.coords.latitude, lng: pos.coords.longitude };
          console.log('Fresh location received:', coords);
          console.log('Accuracy:', pos.coords.accuracy, 'meters');
          
          // Check if coordinates look reasonable for Delhi area
          const isDelhiArea = coords.lat >= 28.4 && coords.lat <= 28.9 && coords.lng >= 76.8 && coords.lng <= 77.4;
          if (!isDelhiArea) {
            console.warn('Location seems to be outside Delhi area:', coords);
          }
          
          state.userLocation = coords;
          
          state.userMarker = new google.maps.Marker({
            position: coords,
            map: state.map,
            title: 'You are here',
            icon: {
              path: google.maps.SymbolPath.CIRCLE,
              scale: 8,
              fillColor: '#4f46e5',
              fillOpacity: 1,
              strokeColor: '#fff',
              strokeWeight: 2
            }
          });
          
          // Center map on user location and zoom in
          state.map.setCenter(coords);
          state.map.setZoom(13);
          
          resolve(coords);
        },
        err => {
          console.warn('Geolocation error:', err);
          let errorMsg = 'Unable to get your location. ';
          switch(err.code) {
            case err.PERMISSION_DENIED:
              errorMsg += 'Please allow location access in your browser settings.';
              break;
            case err.POSITION_UNAVAILABLE:
              errorMsg += 'Location information is unavailable.';
              break;
            case err.TIMEOUT:
              errorMsg += 'Location request timed out.';
              break;
            default:
              errorMsg += 'An unknown error occurred.';
              break;
          }
          alert(errorMsg);
          resolve(null);
        },
        { 
          enableHighAccuracy: true, 
          maximumAge: 0, // Don't use cached location - force fresh request
          timeout: 20000 // Increased timeout to 20 seconds
        }
      );
    });
  }
  
  async function findNearbyCafes(forcedLocation, categoryType) {
    if (!state.isOnline) return;
    showSkeletons(true);
  
    const keyword = document.getElementById('queryInput')?.value?.trim() || '';
    const priceStr = document.getElementById('priceFilter')?.value || '';
    const minRating = parseFloat(document.getElementById('ratingFilter')?.value || '0');
    const preferWifi = document.getElementById('wifiFilter')?.checked || false;
    const openNow = document.getElementById('openNowFilter')?.checked || false;
    let radius = parseInt(document.getElementById('radiusFilter')?.value || '2000', 10);
  
    const location = forcedLocation || state.userLocation || state.map.getCenter().toJSON();
  
    // Prefer map bounds-derived radius if available (search this area UX)
    try {
      const bounds = state.map.getBounds();
      if (bounds) {
        const center = bounds.getCenter();
        const ne = bounds.getNorthEast();
        const meters = google.maps.geometry.spherical.computeDistanceBetween(center, ne);
        radius = Math.min(Math.max(Math.round(meters), 500), 20000);
      }
    } catch {}
  
    // If there is a keyword, use Text Search to widen search results and support restaurants
    const hasKeyword = keyword.length > 0;
    let results = [];
    if (hasKeyword && state.placesService?.textSearch) {
      const textReq = {
        location,
        radius,
        query: keyword,
        type: categoryType || undefined,
        openNow: openNow || undefined
      };
      results = await textSearchAsync(textReq);
    } else {
      const nearbyReq = {
        location,
        radius,
        keyword: keyword || categoryType || 'restaurant',
        type: categoryType || 'restaurant',
        openNow: openNow || undefined
      };
      results = await nearbySearchAsync(nearbyReq);
    }
  
    // Fallbacks if no results
    if (!results || results.length === 0) {
      // Try nearby with 'restaurant' if we didn't already
      const fallbackReq = {
        location,
        radius,
        keyword: 'restaurant',
        type: categoryType || 'restaurant',
        openNow: openNow || undefined
      };
      results = await nearbySearchAsync(fallbackReq);
    }
    if (!results || results.length === 0) {
      // Final fallback: nearby cafes
      const fallbackCafeReq = {
        location,
        radius,
        keyword: 'cafe',
        type: 'cafe',
        openNow: openNow || undefined
      };
      results = await nearbySearchAsync(fallbackCafeReq);
    }
  
    // Filter client-side by rating, price, wifi
    let filtered = results.filter(r => (r.rating || 0) >= minRating);
    if (priceStr) {
      const price = parseInt(priceStr, 10);
      filtered = filtered.filter(r => r.price_level === price);
    }
    if (preferWifi) {
      filtered = filtered.filter(r => (r.types || []).includes('internet_cafe') || (r.user_ratings_total || 0) > 0);
    }
    // min reviews filter removed per request
  
    // Enrich with distance
    const withDistance = filtered.map(place => {
      const distanceMeters = google.maps.geometry
        ? google.maps.geometry.spherical.computeDistanceBetween(
            new google.maps.LatLng(location.lat, location.lng),
            place.geometry.location
          )
        : null;
      return { ...place, distanceMeters };
    });
  
    // Sort by distance
    withDistance.sort((a, b) => (a.distanceMeters ?? 0) - (b.distanceMeters ?? 0));
  
    state.lastResults = withDistance;
    cacheResults(withDistance, location);
    renderResults(withDistance, location);
    addMarkers(withDistance);
    showSkeletons(false);
  }
  
  function nearbySearchAsync(request) {
    return new Promise(resolve => {
      state.placesService.nearbySearch(request, (results, status) => {
        if (status !== google.maps.places.PlacesServiceStatus.OK || !results) {
          resolve([]);
          return;
        }
        resolve(results);
      });
    });
  }
  
  function textSearchAsync(request) {
    return new Promise(resolve => {
      state.placesService.textSearch(request, (results, status) => {
        if (status !== google.maps.places.PlacesServiceStatus.OK || !results) {
          resolve([]);
          return;
        }
        resolve(results);
      });
    });
  }
  
  function addMarkers(places) {
    try { state.directionsRenderer.set('directions', null); } catch {}
    if (state.markerClusterer) {
      state.markerClusterer.clearMarkers();
      state.markerClusterer = null;
    }
    state.placeMarkers.forEach(m => m.setMap(null));
    state.placeMarkers = [];
    state.placeIdToMarker = {};
  
    const info = new google.maps.InfoWindow();
    places.slice(0, 200).forEach(place => {
      if (!place.geometry?.location) return;
      const marker = new google.maps.Marker({
        position: place.geometry.location,
        map: state.map,
        title: place.name,
        animation: google.maps.Animation.DROP
      });
      marker.addListener('click', () => {
        const priceText = typeof place.price_level === 'number' ? '₹'.repeat(place.price_level) : '—';
        const ratingText = place.rating != null ? place.rating.toFixed(1) : '—';
        info.setContent(
          `<div class="min-w-[180px]">
            <div class="font-medium">${place.name || ''}</div>
            <div class="text-xs text-slate-600">${place.vicinity || place.formatted_address || ''}</div>
            <div class="text-xs mt-1">★ ${ratingText} • ${priceText}</div>
          </div>`
        );
        info.open({ map: state.map, anchor: marker });
      });
      state.placeMarkers.push(marker);
      if (place.place_id) state.placeIdToMarker[place.place_id] = marker;
    });
  
    // Cluster markers
    try {
      state.markerClusterer = new markerClusterer.MarkerClusterer({ map: state.map, markers: state.placeMarkers });
    } catch {}
  }
  
  function renderResults(places, origin) {
    const container = document.getElementById('results');
    const count = document.getElementById('resultCount');
    if (!container) return;
  
    container.innerHTML = '';
    count.textContent = String(places.length);
  
    places.forEach(place => {
      const fallbackUrl = 'https://images.unsplash.com/photo-1504754524776-8f4f37790ca0?q=80&w=1200&auto=format&fit=crop';
      const initialUrl = (place.photos && place.photos.length > 0 && place.photos[0].getUrl({ maxWidth: 600, maxHeight: 400 })) || fallbackUrl;
  
      const distanceText = place.distanceMeters != null
        ? (place.distanceMeters < 1000 ? `${Math.round(place.distanceMeters)} m` : `${(place.distanceMeters / 1000).toFixed(1)} km`)
        : '';
  
      const priceText = typeof place.price_level === 'number' ? '₹'.repeat(place.price_level) : '—';
  
      const card = document.createElement('div');
      card.className = 'result-card group overflow-hidden rounded-xl border border-slate-200 hover:border-brand-300 bg-white shadow-lg';
      card.innerHTML = `
        <div class="flex gap-3 p-3">
          <img src="${initialUrl}" alt="${place.name}" class="w-24 h-24 object-cover rounded-lg flex-shrink-0">
          <div class="min-w-0 flex-1">
            <div class="flex items-center justify-between gap-2">
              <h3 class="font-semibold text-slate-800 truncate hover:underline cursor-pointer details-link">${place.name || 'Cafe'}</h3>
              <span class="text-xs text-slate-500">${distanceText}</span>
            </div>
            <div class="mt-1 text-sm text-slate-600 line-clamp-1">${place.vicinity || place.formatted_address || ''}</div>
            <div class="mt-2 flex items-center gap-2 flex-wrap">
              <span class="badge badge-rating">${renderStars(place.rating)} ${place.rating != null ? place.rating.toFixed(1) : '—'}</span>
              <span class="badge badge-price">${priceText || '—'}</span>
              ${place.opening_hours?.open_now ? '<span class="badge badge-open">Open now</span>' : ''}
              <span class="badge badge-type">${(place.types || []).includes('restaurant') ? 'Restaurant' : 'Cafe'}</span>
              <span class="text-xs text-slate-500">📍 ${distanceText}</span>
            </div>
            <div class="mt-2 flex flex-wrap gap-1 mini-tags"></div>
            <div class="mt-3 flex gap-2">
              <button class="dir-btn btn-primary px-4 py-2 rounded-lg bg-brand-600 text-white text-sm font-medium">Get Directions</button>
              <a class="px-4 py-2 rounded-lg border border-slate-300 text-sm hover:bg-slate-50 transition smooth-transition" href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(place.name)}&query_place_id=${place.place_id}" target="_blank" rel="noopener">Open in Maps</a>
            </div>
          </div>
        </div>
      `;
  
      // If we used the fallback, try to fetch a real photo via Place Details and update the image
      const imgEl = card.querySelector('img');
      if (imgEl && imgEl.src === fallbackUrl) {
        tryLoadPlacePhoto(place.place_id, imgEl);
      }
      // Open details modal when clicking the place name and highlight marker
      card.querySelector('.details-link')?.addEventListener('click', () => {
        showPlaceDetails(place.place_id, place.name);
        const m = place.place_id ? state.placeIdToMarker[place.place_id] : null;
        if (m) {
          state.map.panTo(m.getPosition());
          m.setAnimation(google.maps.Animation.DROP);
          setTimeout(() => m.setAnimation(null), 700);
        }
      });
  
      // Mini review tags, once per place_id
      const miniTagsContainer = card.querySelector('.mini-tags');
      if (miniTagsContainer && place.place_id && !state.miniTagLoaded.has(place.place_id)) {
        state.miniTagLoaded.add(place.place_id);
        fetchMiniTags(place.place_id).then(tags => {
          if (!tags || tags.length === 0) return;
          miniTagsContainer.innerHTML = tags.map(t => `<span class="text-[11px] px-2 py-0.5 rounded-full border bg-slate-50">${t}</span>`).join(' ');
        });
      }
  
      card.querySelector('.dir-btn')?.addEventListener('click', () => {
        if (!origin) return;
        showDirections(origin, place.geometry.location.toJSON());
      });
  
      // Mini review tags: fetch small set of reviews and render short tags
      const tagsEl = document.createElement('div');
      tagsEl.className = 'mt-2 flex flex-wrap gap-1';
      container.appendChild(tagsEl);
      fetchMiniTags(place.place_id).then(tags => {
        if (!tags || tags.length === 0) return;
        tagsEl.innerHTML = tags.map(t => `<span class="text-[11px] px-2 py-0.5 rounded-full border bg-slate-50">${t}</span>`).join(' ');
      });
  
      container.appendChild(card);
    });
  }
  
  function showDirections(origin, destination) {
    state.directionsService.route(
      {
        origin,
        destination,
        travelMode: google.maps.TravelMode.WALKING
      },
      (result, status) => {
        if (status === google.maps.DirectionsStatus.OK) {
          state.directionsRenderer.setDirections(result);
        }
      }
    );
  }
  
  function cacheResults(results, userLocation) {
    try {
      const toStore = results.map(r => ({
        name: r.name,
        vicinity: r.vicinity,
        rating: r.rating,
        price_level: r.price_level,
        types: r.types,
        geometry: { location: r.geometry.location.toJSON() },
        place_id: r.place_id,
        distanceMeters: r.distanceMeters
      }));
      localStorage.setItem('lastCafeResults', JSON.stringify({ results: toStore, userLocation }));
    } catch {}
  }
  
  function loadCachedResults() {
    try {
      const raw = localStorage.getItem('lastCafeResults');
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      parsed.results = parsed.results.map(r => ({
        ...r,
        geometry: { location: new google.maps.LatLng(r.geometry.location.lat, r.geometry.location.lng) }
      }));
      return parsed;
    } catch {
      return null;
    }
  }
  
  function tryLoadPlacePhoto(placeId, imgEl) {
    if (!placeId || !state.placesService?.getDetails) return;
    state.placesService.getDetails({ placeId, fields: ['photos'] }, (place, status) => {
      if (status !== google.maps.places.PlacesServiceStatus.OK || !place || !place.photos || !place.photos.length) return;
      try {
        const url = place.photos[0].getUrl({ maxWidth: 800, maxHeight: 600 });
        if (url) imgEl.src = url;
      } catch {}
    });
  }
  
  function fetchMiniTags(placeId) {
    return new Promise(resolve => {
      if (!placeId || !state.placesService?.getDetails) return resolve([]);
      state.placesService.getDetails(
        { placeId, fields: ['reviews', 'types'] },
        (place, status) => {
          if (status !== google.maps.places.PlacesServiceStatus.OK || !place) return resolve([]);
          const reviews = place.reviews || [];
          const texts = reviews.slice(0, 10).map(r => (r.text || '').toLowerCase());
          const tags = [];
          // Simple heuristics for short tags
          if (texts.some(t => t.includes('biryani') || t.includes('pizza') || t.includes('burger') || t.includes('coffee'))) tags.push('must-try item');
          if (texts.some(t => t.includes('taste') || t.includes('tasty') || t.includes('delicious') || t.includes('yummy'))) tags.push('good food');
          if (texts.some(t => t.includes('ambience') || t.includes('vibe') || t.includes('cozy') || t.includes('music'))) tags.push('good vibe');
          if (texts.some(t => t.includes('service') || t.includes('staff') || t.includes('friendly'))) tags.push('friendly service');
          resolve(tags.slice(0, 3));
        }
      );
    });
  }
  
  function openModal(contentHtml, title) {
    const modal = document.getElementById('detailsModal');
    const body = document.getElementById('detailsBody');
    const heading = document.getElementById('detailsTitle');
    if (!modal || !body || !heading) return;
    heading.textContent = title || 'Details';
    body.innerHTML = contentHtml || '';
    modal.classList.remove('hidden');
    modal.classList.add('flex');
  }
  
  function closeModal() {
    const modal = document.getElementById('detailsModal');
    if (!modal) return;
    modal.classList.add('hidden');
    modal.classList.remove('flex');
  }
  
  document.getElementById('detailsClose')?.addEventListener('click', closeModal);
  
  document.getElementById('detailsModal')?.addEventListener('click', e => {
    if (e.target && e.target === document.getElementById('detailsModal')) closeModal();
  });
  
  function showPlaceDetails(placeId, fallbackName) {
    if (!placeId || !state.placesService?.getDetails) return;
    const skeleton = `
      <div class="animate-pulse space-y-3">
        <div class="h-40 bg-slate-200 rounded-lg"></div>
        <div class="h-4 bg-slate-200 rounded w-1/2"></div>
        <div class="h-4 bg-slate-200 rounded w-1/3"></div>
      </div>`;
    openModal(skeleton, fallbackName || 'Loading…');
    state.placesService.getDetails(
      { placeId, fields: ['name','rating','user_ratings_total','formatted_address','formatted_phone_number','website','opening_hours','photos','price_level','reviews'] },
      (place, status) => {
        if (status !== google.maps.places.PlacesServiceStatus.OK || !place) {
          openModal('<div class="text-slate-600">Unable to load details right now.</div>', fallbackName || 'Details');
          return;
        }
        const photos = (place.photos || []).slice(0, 6).map(p => p.getUrl({ maxWidth: 900, maxHeight: 600 }));
        const photoHtml = photos.length
          ? `<div class="grid grid-cols-2 sm:grid-cols-3 gap-2">${photos.map(u => `<img src="${u}" class="w-full h-40 object-cover rounded-lg"/>`).join('')}</div>`
          : '<div class="text-sm text-slate-500">No photos available.</div>';
        const priceText = typeof place.price_level === 'number' ? '₹'.repeat(place.price_level) : '—';
        const hours = place.opening_hours?.weekday_text?.length
          ? `<ul class="text-sm text-slate-700 space-y-1">${place.opening_hours.weekday_text.map(h => `<li>${h}</li>`).join('')}</ul>`
          : '<div class="text-sm text-slate-500">Hours not available</div>';
        const website = place.website ? `<a class="text-brand-600 underline" href="${place.website}" target="_blank" rel="noopener">Website</a>` : '';
        // Menu link removed per request
        const body = `
          ${photoHtml}
          <div class="mt-3 space-y-3">
            <div class="text-slate-700">${place.formatted_address || ''}</div>
            <div class="text-sm text-slate-700">★ ${place.rating ?? '—'} (${place.user_ratings_total ?? 0}) • ${priceText}</div>
            <div class="text-sm text-slate-700">${place.formatted_phone_number || ''}</div>
            
            <div class="mt-2">
              <div class="font-medium text-slate-800 mb-1">Opening hours</div>
              <div class="max-h-40 overflow-auto pr-1">${hours}</div>
            </div>
            <div class="mt-2">
              <div class="font-medium text-slate-800 mb-1">Recent reviews</div>
              ${renderReviews(place.reviews)}
            </div>
          </div>`;
        openModal(body, place.name || fallbackName || 'Details');
      }
    );
  }
  
  function renderReviews(reviews) {
    try {
      if (!reviews || !reviews.length) return '<div class="text-sm text-slate-500">No reviews available.</div>';
      const items = reviews.slice(0, 5).map(r => {
        const author = r.author_name ? `<span class="font-medium">${r.author_name}</span>` : 'Anonymous';
        const rating = r.rating != null ? `★ ${r.rating}` : '';
        const text = (r.text || '').split('\n').join(' ');
        const short = text.length > 160 ? text.slice(0, 157) + '…' : text;
        return `<div class="text-sm border-b border-slate-100 py-2">${author} <span class="text-xs text-slate-500">${rating}</span><div class="text-slate-700">${short}</div></div>`;
      }).join('');
      return `<div class="space-y-1">${items}</div>`;
    } catch {
      return '<div class="text-sm text-slate-500">No reviews available.</div>';
    }
  }
  
  function showSkeletons(show) {
    const res = document.getElementById('results');
    const sk = document.getElementById('resultsSkeleton');
    if (!res || !sk) return;
    if (show) { sk.classList.remove('hidden'); res.classList.add('hidden'); }
    else { sk.classList.add('hidden'); res.classList.remove('hidden'); }
  }
  
  // Helper function to render star rating
  function renderStars(rating) {
    if (!rating) return '☆☆☆☆☆';
    const fullStars = Math.floor(rating);
    const hasHalfStar = rating % 1 >= 0.5;
    const emptyStars = 5 - fullStars - (hasHalfStar ? 1 : 0);
    
    return '★'.repeat(fullStars) + 
           (hasHalfStar ? '☆' : '') + 
           '☆'.repeat(emptyStars);
  }
  
  // Hero section functionality
  function initHero() {
    const startBtn = document.getElementById('startSearchBtn');
    const heroSection = document.getElementById('heroSection');
    const mainContent = document.getElementById('mainContent');
    const searchSection = document.getElementById('searchSection');
    const mainHeader = document.getElementById('mainHeader');
    
    if (startBtn && heroSection && mainContent && searchSection && mainHeader) {
      startBtn.addEventListener('click', () => {
        heroSection.style.display = 'none';
        mainHeader.style.display = 'none';
        mainContent.classList.remove('hidden');
        searchSection.classList.remove('hidden');
        // Do NOT call initMap directly. It will be called by Google Maps API when loaded.
      });
    }
  }
  
  // Initialize hero on page load
  document.addEventListener('DOMContentLoaded', () => {
    initHero();
    loadGoogleMapsScript();
  });

  // Dynamically load Google Maps JS API using .env key (Vite)
  function loadGoogleMapsScript() {
    const apiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY;
    if (!apiKey) {
      console.error('Google Maps API key not found in .env');
      return;
    }
    if (document.getElementById('google-maps-script')) return; // Prevent duplicate
    const script = document.createElement('script');
    script.id = 'google-maps-script';
    script.src = `https://maps.googleapis.com/maps/api/js?key=${apiKey}&libraries=places,geometry&callback=initMap`;
    script.async = true;
    script.defer = true;
    document.body.appendChild(script);
  }

  // Expose initMap for Google callback
  window.initMap = initMap;
  

