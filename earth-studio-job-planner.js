(function earthStudioJobPlanner(globalScope) {
  "use strict";

  const DEFAULT_OUTPUT_DIR = "/home/vidtoolz/Videos/vidtoolz-earth-studio-jobs";
  const VERSION = "0.5.0"; // v0.5: .esp serialization rewritten to the real reverse-engineered Earth Studio format (modelVersion 17) after real Earth Studio refused the v0.4 guess (acceptance round 1, 2026-08-07); keyframe engine and grammar unchanged from v0.4
  const FRAME_RATE = 30;
  const DEFAULT_ALTITUDE_M = 2500;
  const MIN_ALTITUDE_M = 150;
  const MAX_ALTITUDE_M = 63170000; // Earth Studio's documented altitude ceiling
  const SPACE_ALTITUDE_M = 12000000; // "from space": whole-globe view
  const EXPECTED_FILES = [
    "README.md",
    "shot-plan.json",
    "shot-plan.md",
    "route.kml",
    "earth-studio-build-checklist.md",
    "earth-studio.esp",
  ];

  // Per-action defaults so a bare "fly to Paris, then orbit" still produces a
  // complete, renderable plan. Durations in seconds; tilt in degrees from
  // straight-down (0 = top-down map view, ~70 = toward the horizon).
  const DEFAULT_DURATION_S = { fly_to: 4, hover: 3, orbit: 6, zoom_in: 3, zoom_out: 4 };
  const DEFAULT_TILT_DEG = { fly_to: 45, hover: 50, orbit: 60, zoom_in: 45, zoom_out: 35 };
  const ZOOM_IN_ALTITUDE_M = 800;
  const ZOOM_OUT_ALTITUDE_M = 6000;

  // Render aspect ratios. VIDTOOLZ is a Shorts channel, so the GUI defaults to
  // 9:16; the module default stays 16:9 to match every artifact generated
  // before aspect existed (incl. the pinned London proof).
  const ASPECTS = {
    "16:9": { width: 1920, height: 1080 },
    "9:16": { width: 1080, height: 1920 },
    "1:1": { width: 1080, height: 1080 },
  };
  const DEFAULT_ASPECT = "16:9";

  // Built-in gazetteer (offline, no external geocoding API). Explicit
  // "lat,lng" coordinates in the description are also supported, so any
  // location is reachable without a network call. Optional per-place fields:
  // - altitude_m: nicer default camera altitude for the place (landmarks sit
  //   lower, mountains higher).
  // - min_altitude_m: floor for high-terrain places so computed altitudes
  //   (zoom targets, arc endpoints) never end up inside the ground. Earth
  //   Studio altitude keyframes are meters above sea level, best-effort.
  const LOCATION_FIXTURES = {
    // Finland + Nordics + Baltics
    "helsinki": { name: "Helsinki", latitude: 60.1699, longitude: 24.9384 },
    "espoo": { name: "Espoo", latitude: 60.2055, longitude: 24.6559 },
    "tampere": { name: "Tampere", latitude: 61.4978, longitude: 23.761 },
    "turku": { name: "Turku", latitude: 60.4518, longitude: 22.2666 },
    "oulu": { name: "Oulu", latitude: 65.0121, longitude: 25.4651 },
    "rovaniemi": { name: "Rovaniemi", latitude: 66.5039, longitude: 25.7294 },
    "suomenlinna": { name: "Suomenlinna", latitude: 60.1454, longitude: 24.9881, altitude_m: 1200 },
    "helsinki cathedral": { name: "Helsinki Cathedral", latitude: 60.1704, longitude: 24.9522, altitude_m: 700 },
    "stockholm": { name: "Stockholm", latitude: 59.3293, longitude: 18.0686 },
    "gothenburg": { name: "Gothenburg", latitude: 57.7089, longitude: 11.9746 },
    "oslo": { name: "Oslo", latitude: 59.9139, longitude: 10.7522 },
    "bergen": { name: "Bergen", latitude: 60.3913, longitude: 5.3221 },
    "trondheim": { name: "Trondheim", latitude: 63.4305, longitude: 10.3951 },
    "lofoten": { name: "Lofoten", latitude: 68.2094, longitude: 13.6, altitude_m: 3000 },
    "geirangerfjord": { name: "Geirangerfjord", latitude: 62.1049, longitude: 7.2054, altitude_m: 2500, min_altitude_m: 1000 },
    "copenhagen": { name: "Copenhagen", latitude: 55.6761, longitude: 12.5683 },
    "reykjavik": { name: "Reykjavik", latitude: 64.1466, longitude: -21.9426 },
    "tallinn": { name: "Tallinn", latitude: 59.437, longitude: 24.7536 },
    "riga": { name: "Riga", latitude: 56.9496, longitude: 24.1052 },
    "vilnius": { name: "Vilnius", latitude: 54.6872, longitude: 25.2797 },
    // Europe
    "london": { name: "London", latitude: 51.5074, longitude: -0.1278 },
    "manchester": { name: "Manchester", latitude: 53.4808, longitude: -2.2426 },
    "edinburgh": { name: "Edinburgh", latitude: 55.9533, longitude: -3.1883 },
    "dublin": { name: "Dublin", latitude: 53.3498, longitude: -6.2603 },
    "paris": { name: "Paris", latitude: 48.8566, longitude: 2.3522 },
    "nice": { name: "Nice", latitude: 43.7102, longitude: 7.262 },
    "amsterdam": { name: "Amsterdam", latitude: 52.3676, longitude: 4.9041 },
    "brussels": { name: "Brussels", latitude: 50.8503, longitude: 4.3517 },
    "berlin": { name: "Berlin", latitude: 52.52, longitude: 13.405 },
    "munich": { name: "Munich", latitude: 48.1351, longitude: 11.582 },
    "hamburg": { name: "Hamburg", latitude: 53.5511, longitude: 9.9937 },
    "frankfurt": { name: "Frankfurt", latitude: 50.1109, longitude: 8.6821 },
    "vienna": { name: "Vienna", latitude: 48.2082, longitude: 16.3738 },
    "zurich": { name: "Zurich", latitude: 47.3769, longitude: 8.5417 },
    "geneva": { name: "Geneva", latitude: 46.2044, longitude: 6.1432 },
    "prague": { name: "Prague", latitude: 50.0755, longitude: 14.4378 },
    "warsaw": { name: "Warsaw", latitude: 52.2297, longitude: 21.0122 },
    "krakow": { name: "Krakow", latitude: 50.0647, longitude: 19.945 },
    "budapest": { name: "Budapest", latitude: 47.4979, longitude: 19.0402 },
    "rome": { name: "Rome", latitude: 41.9028, longitude: 12.4964 },
    "milan": { name: "Milan", latitude: 45.4642, longitude: 9.19 },
    "venice": { name: "Venice", latitude: 45.4408, longitude: 12.3155 },
    "florence": { name: "Florence", latitude: 43.7696, longitude: 11.2558 },
    "naples": { name: "Naples", latitude: 40.8518, longitude: 14.2681 },
    "madrid": { name: "Madrid", latitude: 40.4168, longitude: -3.7038 },
    "barcelona": { name: "Barcelona", latitude: 41.3874, longitude: 2.1686 },
    "seville": { name: "Seville", latitude: 37.3891, longitude: -5.9845 },
    "lisbon": { name: "Lisbon", latitude: 38.7223, longitude: -9.1393 },
    "porto": { name: "Porto", latitude: 41.1579, longitude: -8.6291 },
    "athens": { name: "Athens", latitude: 37.9838, longitude: 23.7275 },
    "istanbul": { name: "Istanbul", latitude: 41.0082, longitude: 28.9784 },
    "moscow": { name: "Moscow", latitude: 55.7558, longitude: 37.6173 },
    "st petersburg": { name: "St. Petersburg", latitude: 59.9311, longitude: 30.3609 },
    "kyiv": { name: "Kyiv", latitude: 50.4501, longitude: 30.5234 },
    "santorini": { name: "Santorini", latitude: 36.3932, longitude: 25.4615, altitude_m: 3000 },
    "matterhorn": { name: "Matterhorn", latitude: 45.9766, longitude: 7.6585, altitude_m: 6500, min_altitude_m: 5500 },
    "mont blanc": { name: "Mont Blanc", latitude: 45.8326, longitude: 6.8652, altitude_m: 7000, min_altitude_m: 6000 },
    "neuschwanstein castle": { name: "Neuschwanstein Castle", latitude: 47.5576, longitude: 10.7498, altitude_m: 1800, min_altitude_m: 1400 },
    "eiffel tower": { name: "Eiffel Tower", latitude: 48.8584, longitude: 2.2945, altitude_m: 1000 },
    "louvre": { name: "Louvre", latitude: 48.8606, longitude: 2.3376, altitude_m: 700 },
    "big ben": { name: "Big Ben", latitude: 51.5007, longitude: -0.1246, altitude_m: 700 },
    "tower bridge": { name: "Tower Bridge", latitude: 51.5055, longitude: -0.0754, altitude_m: 700 },
    "buckingham palace": { name: "Buckingham Palace", latitude: 51.5014, longitude: -0.1419, altitude_m: 700 },
    "colosseum": { name: "Colosseum", latitude: 41.8902, longitude: 12.4922, altitude_m: 700 },
    "vatican": { name: "Vatican", latitude: 41.9022, longitude: 12.4539, altitude_m: 800 },
    "acropolis": { name: "Acropolis", latitude: 37.9715, longitude: 23.7257, altitude_m: 800 },
    "sagrada familia": { name: "Sagrada Familia", latitude: 41.4036, longitude: 2.1744, altitude_m: 700 },
    "brandenburg gate": { name: "Brandenburg Gate", latitude: 52.5163, longitude: 13.3777, altitude_m: 600 },
    "red square": { name: "Red Square", latitude: 55.7539, longitude: 37.6208, altitude_m: 800 },
    "hagia sophia": { name: "Hagia Sophia", latitude: 41.0086, longitude: 28.9802, altitude_m: 700 },
    // Africa + Middle East
    "cairo": { name: "Cairo", latitude: 30.0444, longitude: 31.2357 },
    "pyramids of giza": { name: "Pyramids of Giza", latitude: 29.9792, longitude: 31.1342, altitude_m: 1200 },
    "marrakesh": { name: "Marrakesh", latitude: 31.6295, longitude: -7.9811 },
    "cape town": { name: "Cape Town", latitude: -33.9249, longitude: 18.4241 },
    "table mountain": { name: "Table Mountain", latitude: -33.9628, longitude: 18.4098, altitude_m: 2200, min_altitude_m: 1800 },
    "johannesburg": { name: "Johannesburg", latitude: -26.2041, longitude: 28.0473, min_altitude_m: 2400 },
    "nairobi": { name: "Nairobi", latitude: -1.2921, longitude: 36.8219, min_altitude_m: 2500 },
    "lagos": { name: "Lagos", latitude: 6.5244, longitude: 3.3792 },
    "kilimanjaro": { name: "Kilimanjaro", latitude: -3.0674, longitude: 37.3556, altitude_m: 7000, min_altitude_m: 6300 },
    "victoria falls": { name: "Victoria Falls", latitude: -17.9243, longitude: 25.8572, altitude_m: 1800, min_altitude_m: 1200 },
    "dubai": { name: "Dubai", latitude: 25.2048, longitude: 55.2708 },
    "burj khalifa": { name: "Burj Khalifa", latitude: 25.1972, longitude: 55.2744, altitude_m: 1100 },
    "palm jumeirah": { name: "Palm Jumeirah", latitude: 25.1124, longitude: 55.139, altitude_m: 2500 },
    "abu dhabi": { name: "Abu Dhabi", latitude: 24.4539, longitude: 54.3773 },
    "doha": { name: "Doha", latitude: 25.2854, longitude: 51.531 },
    "jerusalem": { name: "Jerusalem", latitude: 31.7683, longitude: 35.2137, min_altitude_m: 1500 },
    "tel aviv": { name: "Tel Aviv", latitude: 32.0853, longitude: 34.7818 },
    "petra": { name: "Petra", latitude: 30.3285, longitude: 35.4444, altitude_m: 1800, min_altitude_m: 1400 },
    "riyadh": { name: "Riyadh", latitude: 24.7136, longitude: 46.6753, min_altitude_m: 1400 },
    // Asia
    "mumbai": { name: "Mumbai", latitude: 19.076, longitude: 72.8777 },
    "delhi": { name: "Delhi", latitude: 28.7041, longitude: 77.1025 },
    "bangalore": { name: "Bangalore", latitude: 12.9716, longitude: 77.5946, min_altitude_m: 1700 },
    "taj mahal": { name: "Taj Mahal", latitude: 27.1751, longitude: 78.0421, altitude_m: 800 },
    "kathmandu": { name: "Kathmandu", latitude: 27.7172, longitude: 85.324, min_altitude_m: 2200 },
    "mount everest": { name: "Mount Everest", latitude: 27.9881, longitude: 86.925, altitude_m: 10000, min_altitude_m: 9200 },
    "bangkok": { name: "Bangkok", latitude: 13.7563, longitude: 100.5018 },
    "hanoi": { name: "Hanoi", latitude: 21.0278, longitude: 105.8342 },
    "ho chi minh city": { name: "Ho Chi Minh City", latitude: 10.8231, longitude: 106.6297 },
    "kuala lumpur": { name: "Kuala Lumpur", latitude: 3.139, longitude: 101.6869 },
    "singapore": { name: "Singapore", latitude: 1.3521, longitude: 103.8198 },
    "marina bay sands": { name: "Marina Bay Sands", latitude: 1.2834, longitude: 103.8607, altitude_m: 700 },
    "jakarta": { name: "Jakarta", latitude: -6.2088, longitude: 106.8456 },
    "bali": { name: "Bali", latitude: -8.4095, longitude: 115.1889, altitude_m: 3000 },
    "manila": { name: "Manila", latitude: 14.5995, longitude: 120.9842 },
    "hong kong": { name: "Hong Kong", latitude: 22.3193, longitude: 114.1694 },
    "shanghai": { name: "Shanghai", latitude: 31.2304, longitude: 121.4737 },
    "beijing": { name: "Beijing", latitude: 39.9042, longitude: 116.4074 },
    "forbidden city": { name: "Forbidden City", latitude: 39.9163, longitude: 116.3972, altitude_m: 800 },
    "great wall of china": { name: "Great Wall of China", latitude: 40.4319, longitude: 116.5704, altitude_m: 1800, min_altitude_m: 1300 },
    "shenzhen": { name: "Shenzhen", latitude: 22.5431, longitude: 114.0579 },
    "taipei": { name: "Taipei", latitude: 25.033, longitude: 121.5654 },
    "seoul": { name: "Seoul", latitude: 37.5665, longitude: 126.978 },
    "tokyo": { name: "Tokyo", latitude: 35.6762, longitude: 139.6503 },
    "shibuya crossing": { name: "Shibuya Crossing", latitude: 35.6595, longitude: 139.7005, altitude_m: 500 },
    "osaka": { name: "Osaka", latitude: 34.6937, longitude: 135.5023 },
    "kyoto": { name: "Kyoto", latitude: 35.0116, longitude: 135.7681 },
    "mount fuji": { name: "Mount Fuji", latitude: 35.3606, longitude: 138.7274, altitude_m: 5500, min_altitude_m: 4300 },
    "angkor wat": { name: "Angkor Wat", latitude: 13.4125, longitude: 103.867, altitude_m: 1000 },
    // Oceania
    "sydney": { name: "Sydney", latitude: -33.8688, longitude: 151.2093 },
    "sydney opera house": { name: "Sydney Opera House", latitude: -33.8568, longitude: 151.2153, altitude_m: 700 },
    "melbourne": { name: "Melbourne", latitude: -37.8136, longitude: 144.9631 },
    "brisbane": { name: "Brisbane", latitude: -27.4698, longitude: 153.0251 },
    "perth": { name: "Perth", latitude: -31.9505, longitude: 115.8605 },
    "uluru": { name: "Uluru", latitude: -25.3444, longitude: 131.0369, altitude_m: 2200, min_altitude_m: 1300 },
    "great barrier reef": { name: "Great Barrier Reef", latitude: -18.2871, longitude: 147.6992, altitude_m: 5000 },
    "auckland": { name: "Auckland", latitude: -36.8509, longitude: 174.7645 },
    "wellington": { name: "Wellington", latitude: -41.2924, longitude: 174.7787 },
    "queenstown": { name: "Queenstown", latitude: -45.0312, longitude: 168.6626, min_altitude_m: 1500 },
    // North America
    "new york": { name: "New York", latitude: 40.7128, longitude: -74.006 },
    "midtown manhattan": { name: "Midtown Manhattan", latitude: 40.7549, longitude: -73.984 },
    "lower manhattan": { name: "Lower Manhattan", latitude: 40.7128, longitude: -74.006 },
    "times square": { name: "Times Square", latitude: 40.758, longitude: -73.9855, altitude_m: 550 },
    "central park": { name: "Central Park", latitude: 40.7829, longitude: -73.9654, altitude_m: 1200 },
    "statue of liberty": { name: "Statue of Liberty", latitude: 40.6892, longitude: -74.0445, altitude_m: 800 },
    "brooklyn bridge": { name: "Brooklyn Bridge", latitude: 40.7061, longitude: -73.9969, altitude_m: 700 },
    "boston": { name: "Boston", latitude: 42.3601, longitude: -71.0589 },
    "downtown boston": { name: "Downtown Boston", latitude: 42.3555, longitude: -71.0565 },
    "washington dc": { name: "Washington DC", latitude: 38.9072, longitude: -77.0369 },
    "philadelphia": { name: "Philadelphia", latitude: 39.9526, longitude: -75.1652 },
    "miami": { name: "Miami", latitude: 25.7617, longitude: -80.1918 },
    "orlando": { name: "Orlando", latitude: 28.5383, longitude: -81.3792 },
    "atlanta": { name: "Atlanta", latitude: 33.749, longitude: -84.388 },
    "chicago": { name: "Chicago", latitude: 41.8781, longitude: -87.6298 },
    "detroit": { name: "Detroit", latitude: 42.3314, longitude: -83.0458 },
    "toronto": { name: "Toronto", latitude: 43.6532, longitude: -79.3832 },
    "cn tower": { name: "CN Tower", latitude: 43.6426, longitude: -79.3871, altitude_m: 800 },
    "montreal": { name: "Montreal", latitude: 45.5017, longitude: -73.5673 },
    "vancouver": { name: "Vancouver", latitude: 49.2827, longitude: -123.1207 },
    "seattle": { name: "Seattle", latitude: 47.6062, longitude: -122.3321 },
    "portland": { name: "Portland", latitude: 45.5152, longitude: -122.6784 },
    "san francisco": { name: "San Francisco", latitude: 37.7749, longitude: -122.4194 },
    "golden gate bridge": { name: "Golden Gate Bridge", latitude: 37.8199, longitude: -122.4783, altitude_m: 1000 },
    "los angeles": { name: "Los Angeles", latitude: 34.0522, longitude: -118.2437 },
    "hollywood sign": { name: "Hollywood Sign", latitude: 34.1341, longitude: -118.3215, altitude_m: 900 },
    "san diego": { name: "San Diego", latitude: 32.7157, longitude: -117.1611 },
    "las vegas": { name: "Las Vegas", latitude: 36.1699, longitude: -115.1398 },
    "phoenix": { name: "Phoenix", latitude: 33.4484, longitude: -112.074 },
    "denver": { name: "Denver", latitude: 39.7392, longitude: -104.9903, min_altitude_m: 2600 },
    "austin": { name: "Austin", latitude: 30.2672, longitude: -97.7431 },
    "dallas": { name: "Dallas", latitude: 32.7767, longitude: -96.797 },
    "houston": { name: "Houston", latitude: 29.7604, longitude: -95.3698 },
    "new orleans": { name: "New Orleans", latitude: 29.9511, longitude: -90.0715 },
    "honolulu": { name: "Honolulu", latitude: 21.3069, longitude: -157.8583 },
    "anchorage": { name: "Anchorage", latitude: 61.2181, longitude: -149.9003 },
    "grand canyon": { name: "Grand Canyon", latitude: 36.0544, longitude: -112.1401, altitude_m: 4000, min_altitude_m: 2700 },
    "niagara falls": { name: "Niagara Falls", latitude: 43.0962, longitude: -79.0377, altitude_m: 1200 },
    "yosemite": { name: "Yosemite", latitude: 37.8651, longitude: -119.5383, altitude_m: 4500, min_altitude_m: 2800 },
    "yellowstone": { name: "Yellowstone", latitude: 44.428, longitude: -110.5885, altitude_m: 5000, min_altitude_m: 3200 },
    "monument valley": { name: "Monument Valley", latitude: 36.998, longitude: -110.0985, altitude_m: 3200, min_altitude_m: 2400 },
    "mount rushmore": { name: "Mount Rushmore", latitude: 43.8791, longitude: -103.4591, altitude_m: 2200, min_altitude_m: 1800 },
    "banff": { name: "Banff", latitude: 51.4968, longitude: -115.9281, altitude_m: 3500, min_altitude_m: 2200 },
    "mexico city": { name: "Mexico City", latitude: 19.4326, longitude: -99.1332, min_altitude_m: 3200 },
    "chichen itza": { name: "Chichen Itza", latitude: 20.6843, longitude: -88.5678, altitude_m: 1200 },
    "havana": { name: "Havana", latitude: 23.1136, longitude: -82.3666 },
    // South America
    "bogota": { name: "Bogota", latitude: 4.711, longitude: -74.0721, min_altitude_m: 3400 },
    "lima": { name: "Lima", latitude: -12.0464, longitude: -77.0428 },
    "machu picchu": { name: "Machu Picchu", latitude: -13.1631, longitude: -72.545, altitude_m: 3600, min_altitude_m: 3200 },
    "cusco": { name: "Cusco", latitude: -13.5319, longitude: -71.9675, min_altitude_m: 4300 },
    "santiago": { name: "Santiago", latitude: -33.4489, longitude: -70.6693, min_altitude_m: 1300 },
    "buenos aires": { name: "Buenos Aires", latitude: -34.6037, longitude: -58.3816 },
    "rio de janeiro": { name: "Rio de Janeiro", latitude: -22.9068, longitude: -43.1729 },
    "christ the redeemer": { name: "Christ the Redeemer", latitude: -22.9519, longitude: -43.2105, altitude_m: 1300, min_altitude_m: 1000 },
    "sao paulo": { name: "Sao Paulo", latitude: -23.5505, longitude: -46.6333 },
    "iguazu falls": { name: "Iguazu Falls", latitude: -25.6953, longitude: -54.4367, altitude_m: 1800 },
    "torres del paine": { name: "Torres del Paine", latitude: -50.9423, longitude: -73.4068, altitude_m: 4000, min_altitude_m: 2000 },
    "galapagos": { name: "Galapagos", latitude: -0.7439, longitude: -90.307, altitude_m: 5000 },
  };

  // Alternate names → canonical gazetteer key (keys are normalized names).
  const LOCATION_ALIASES = {
    "nyc": "new york",
    "new york city": "new york",
    "manhattan": "midtown manhattan",
    "sf": "san francisco",
    "vegas": "las vegas",
    "washington": "washington dc",
    "dc": "washington dc",
    "saint petersburg": "st petersburg",
    "giza": "pyramids of giza",
    "pyramids": "pyramids of giza",
    "great pyramid": "pyramids of giza",
    "everest": "mount everest",
    "fuji": "mount fuji",
    "ayers rock": "uluru",
    "opera house": "sydney opera house",
    "great wall": "great wall of china",
    "golden gate": "golden gate bridge",
    "hollywood": "hollywood sign",
    "shibuya": "shibuya crossing",
    "vatican city": "vatican",
    "saigon": "ho chi minh city",
    "rio": "rio de janeiro",
    "kiev": "kyiv",
    "yosemite valley": "yosemite",
    "helsinki cathedral church": "helsinki cathedral",
  };

  // Parse an explicit coordinate phrase like "42.3555,-71.0565" or "lat 42.3 lng -71".
  // The bare form requires a , or / separator — a bare space would make phrases
  // with incidental numbers ("Area 51 7") silently resolve as coordinates; the
  // labeled lat/lng form still covers space-separated input.
  function parseExplicitCoords(value) {
    const text = cleanString(value);
    let m = text.match(/(-?\d{1,2}(?:\.\d+)?)\s*[,/]\s*(-?\d{1,3}(?:\.\d+)?)/);
    const latLngLabel = text.match(/lat(?:itude)?\s*(-?\d{1,2}(?:\.\d+)?).*?l(?:ng|on|ongitude)?\s*(-?\d{1,3}(?:\.\d+)?)/i);
    if (latLngLabel) m = latLngLabel;
    if (!m) return null;
    const latitude = Number(m[1]);
    const longitude = Number(m[2]);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
    if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) return null;
    return { name: `${latitude.toFixed(4)}, ${longitude.toFixed(4)}`, latitude, longitude, source: "explicit_coordinates" };
  }

  function cleanString(value) {
    return typeof value === "string" ? value.trim() : "";
  }

  function slugify(value) {
    const slug = cleanString(value)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");
    return slug || "earth-studio-job";
  }

  // Lowercase, strip diacritics ("Bogotá" → "bogota"), drop a leading article,
  // and collapse punctuation runs to single spaces ("St. Petersburg" →
  // "st petersburg") so spoken-style names hit the gazetteer keys.
  function normalizeLocationName(value) {
    let text = cleanString(value).toLowerCase();
    if (typeof text.normalize === "function") text = text.normalize("NFD").replace(/[̀-ͯ]/g, "");
    text = text.replace(/[^a-z0-9]+/g, " ").trim();
    return text.replace(/^(?:the|a|an) /, "");
  }

  function resolveLocation(value) {
    const key = normalizeLocationName(value);
    if (key && LOCATION_FIXTURES[key]) return { ...LOCATION_FIXTURES[key], source: "gazetteer_fixture" };
    if (key && LOCATION_ALIASES[key] && LOCATION_FIXTURES[LOCATION_ALIASES[key]]) {
      return { ...LOCATION_FIXTURES[LOCATION_ALIASES[key]], source: "gazetteer_fixture" };
    }
    const coords = parseExplicitCoords(value);
    if (coords) return coords;
    return null;
  }

  function splitSegments(description) {
    // Protect "lat,lng" pairs and decimals so the comma segment splitter does
    // not shatter explicit coordinates like "35.65,139.84". Periods are NOT
    // segment separators — they would shatter names like "St. Petersburg";
    // segments chain on "then", commas, semicolons, or newlines, and stray
    // sentence periods are trimmed from the segment edges.
    const DOT = "";
    const COMMA = "";
    const protectedText = cleanString(description)
      .replace(/-?\d+(?:\.\d+)?\s*,\s*-?\d+(?:\.\d+)?/g, (m) => m.replace(/\./g, DOT).replace(/,/g, COMMA))
      .replace(/\d+\.\d+/g, (m) => m.replace(/\./g, DOT));
    return protectedText
      .split(/\bthen\b|[,;\n]/i)
      .map((part) => part.split(COMMA).join(",").split(DOT).join(".").replace(/^[\s.]+|[\s.]+$/g, ""))
      .filter(Boolean);
  }

  function extractDurationSeconds(text) {
    const match = cleanString(text).match(/\b(\d+(?:\.\d+)?)\s*(?:seconds?|secs?|sec|s)\b/i);
    if (!match) return null;
    const duration = Number(match[1]);
    return Number.isFinite(duration) && duration > 0 ? duration : null;
  }

  function removeDurationPhrase(text) {
    return cleanString(text)
      .replace(/\b(?:for|in)?\s*\d+(?:\.\d+)?\s*(?:seconds?|secs?|sec|s)\b/i, "")
      .trim();
  }

  // ── Modifier extraction ────────────────────────────────────────────────────
  // Each extractor returns { value fields, text } where text has the matched
  // phrase stripped, so the location extractor sees a clean phrase afterwards.

  // Altitude: numeric ("at 800m", "from 2 km"), "space", or qualitative
  // low/high words. Numeric wins over words.
  function extractAltitudeSpec(text) {
    let t = cleanString(text);
    const numeric = t.match(/\b(?:at|from|to)?\s*\b(\d+(?:\.\d+)?)\s*(m|meters?|metres?|km|kilometers?|kilometres?)\b(?:\s+(?:up|high|altitude|out))?/i);
    if (numeric) {
      const unit = numeric[2].toLowerCase();
      const meters = Number(numeric[1]) * (unit.startsWith("k") ? 1000 : 1);
      return { altitude_m: meters, source: "explicit", text: t.replace(numeric[0], " ").replace(/\s{2,}/g, " ").trim() };
    }
    const space = t.match(/\b(?:to|into|toward|towards|from)?\s*(?:outer\s+)?space\b/i);
    if (space) return { altitude_m: SPACE_ALTITUDE_M, source: "space", text: t.replace(space[0], " ").replace(/\s{2,}/g, " ").trim() };
    const low = t.match(/\b(?:down\s+low|low|close\s+up|up\s+close)\b/i);
    if (low) return { altitude_m: 700, source: "low", text: t.replace(low[0], " ").replace(/\s{2,}/g, " ").trim() };
    const high = t.match(/\b(?:high\s+(?:up|above)|high|wide|far\s+out)\b/i);
    if (high) return { altitude_m: 8000, source: "high", text: t.replace(high[0], " ").replace(/\s{2,}/g, " ").trim() };
    return { altitude_m: null, source: null, text: t };
  }

  // Camera tilt: 0 = straight down, ~70 = toward the horizon.
  function extractTiltSpec(text) {
    let t = cleanString(text);
    const topDown = t.match(/\b(?:top[- ]?down|straight down|overhead|bird'?s[- ]?eye)\b/i);
    if (topDown) return { tilt_deg: 0, text: t.replace(topDown[0], " ").replace(/\s{2,}/g, " ").trim() };
    const degrees = t.match(/\btilted?(?:\s+(?:at|by))?\s+(\d+(?:\.\d+)?)\s*degrees?\b/i);
    if (degrees) return { tilt_deg: Math.min(85, Math.max(0, Number(degrees[1]))), text: t.replace(degrees[0], " ").replace(/\s{2,}/g, " ").trim() };
    const tilted = t.match(/\b(?:tilted|angled)\b/i);
    if (tilted) return { tilt_deg: 60, text: t.replace(tilted[0], " ").replace(/\s{2,}/g, " ").trim() };
    const horizon = t.match(/\b(?:(?:at|toward|towards|to)\s+the\s+horizon|cinematic)\b/i);
    if (horizon) return { tilt_deg: 72, text: t.replace(horizon[0], " ").replace(/\s{2,}/g, " ").trim() };
    return { tilt_deg: null, text: t };
  }

  // Orbit amount + direction: "twice", "3 times", "half", "180 degrees",
  // "counterclockwise". Applied only when the action is orbit; stripped anyway.
  function extractOrbitSpec(text) {
    let t = cleanString(text);
    let degrees = null;
    let direction = 1;
    const apply = (m, value) => { t = t.replace(m[0], " ").replace(/\s{2,}/g, " ").trim(); return value; };
    let m;
    if ((m = t.match(/\b(\d+(?:\.\d+)?)\s*degrees?\b/i))) degrees = apply(m, Number(m[1]));
    else if ((m = t.match(/\btwice\b/i))) degrees = apply(m, 720);
    else if ((m = t.match(/\bthrice\b/i))) degrees = apply(m, 1080);
    else if ((m = t.match(/\b(\d+(?:\.\d+)?)\s*(?:times|turns?|revolutions?|rotations?|laps?)\b/i))) degrees = apply(m, Number(m[1]) * 360);
    else if ((m = t.match(/\bhalf(?:[- ]?way)?\b/i))) degrees = apply(m, 180);
    else if ((m = t.match(/\b(?:a\s+)?quarter\b/i))) degrees = apply(m, 90);
    else if ((m = t.match(/\bonce\b/i))) degrees = apply(m, 360);
    if ((m = t.match(/\b(?:counter[- ]?clockwise|anti[- ]?clockwise|ccw)\b/i))) direction = apply(m, -1);
    else if ((m = t.match(/\bclockwise\b/i))) direction = apply(m, 1);
    return { orbit_degrees: degrees, orbit_direction: direction, text: t };
  }

  function detectAction(text) {
    const lower = cleanString(text).toLowerCase();
    if (/\b(?:orbit(?:s|ing)?|circle(?:s)?|circling|spin(?:s|ning)?\s+around|rotate(?:s)?\s+around)\b/.test(lower)) {
      return { action: "orbit", resolutionStatus: "parsed" };
    }
    if (/\b(?:zoom\s*(?:in|into|in on|closer)|push\s+in|dive|swoop|descend)\b/.test(lower)) {
      return { action: "zoom_in", resolutionStatus: "parsed" };
    }
    if (/\b(?:zoom\s*(?:out|back|away)|pull\s+(?:back|out|away)|ascend|rise|climb)\b/.test(lower)) {
      return { action: "zoom_out", resolutionStatus: "parsed" };
    }
    if (/\b(?:hover|hovers|hovering|hold|holds|stays? (?:over|at|on)|pause|pauses|linger|lingers)\b/.test(lower)) {
      return { action: "hover", resolutionStatus: "parsed" };
    }
    if (/\b(?:move(?:s)? to|fly (?:to|over|across|towards?)|flies to|flyover|travel(?:s)? to|pan(?:s)? to|go(?:es)? to|head(?:s)? to|jump(?:s)? to|cut(?:s)? to|start(?:s)? (?:at|over|on)|begin(?:s)? (?:at|over))\b/.test(lower)) {
      return { action: "fly_to", resolutionStatus: "parsed" };
    }
    return {
      action: "unresolved",
      resolutionStatus: "manual_review",
      warning: "missing or unsupported camera action.",
    };
  }

  function extractLocationPhrase(text, action) {
    const source = cleanString(text);
    let match = null;
    if (action === "hover") {
      match = source.match(/\b(?:hover|hovers|hovering|hold|holds|stays?|pause|pauses|linger|lingers)\s+(?:over\s+|at\s+|on\s+|above\s+)?(.+)$/i);
    } else if (action === "fly_to") {
      match = source.match(/\b(?:move|moves|fly|flies|flyover|travel|travels|pan|pans|go|goes|head|heads|jump|jumps|cut|cuts|start|starts|begin|begins)\s+(?:to\s+|over\s+|across\s+|towards?\s+|at\s+|on\s+)?(.+)$/i);
    } else if (action === "orbit") {
      match = source.match(/\b(?:orbit(?:s|ing)?|circle(?:s)?|circling|spin(?:s|ning)?|rotate(?:s)?)\s+(?:around\s+|round\s+|over\s+|at\s+|above\s+)?(.+)$/i);
    } else if (action === "zoom_in") {
      match = source.match(/\b(?:zoom\s*(?:in|into|in on|closer)|push\s+in|dive|swoop|descend)\s+(?:on\s+|to\s+|into\s+|over\s+|towards?\s+)?(.+)$/i);
    } else if (action === "zoom_out") {
      match = source.match(/\b(?:zoom\s*(?:out|back|away)|pull\s+(?:back|out|away)|ascend|rise|climb)\s+(?:from\s+|of\s+|over\s+|above\s+)?(.+)$/i);
    }
    let phrase = match ? cleanString(match[1]) : "";
    // Trim dangling connective words left behind by modifier stripping
    // ("orbit Paris at" after "at 800m" was removed).
    for (let i = 0; i < 3; i += 1) {
      phrase = phrase.replace(/\s+(?:at|from|to|in|on|over|for|the|a|an|around|towards?|with)$/i, "").trim();
    }
    return phrase;
  }

  function frameForSeconds(seconds, frameRate = FRAME_RATE) {
    return Math.round(seconds * frameRate);
  }

  function clampAltitude(value, minAltitudeM) {
    const floor = Math.max(MIN_ALTITUDE_M, minAltitudeM || 0);
    return Math.min(MAX_ALTITUDE_M, Math.max(floor, value));
  }

  // The segment's END/target camera altitude: explicit spec beats the
  // gazetteer's per-place altitude, which beats the per-action default —
  // always floored by the place's terrain minimum. Returns the value plus its
  // provenance (`source`) so plans and acceptance diagnostics can state where
  // every altitude came from.
  function targetAltitude(action, altitudeSpec, location) {
    const minAlt = (location && location.min_altitude_m) || 0;
    if (altitudeSpec && typeof altitudeSpec.altitude_m === "number") {
      return { value: clampAltitude(altitudeSpec.altitude_m, minAlt), source: altitudeSpec.source === "explicit" ? "explicit" : `semantic_${altitudeSpec.source}` };
    }
    const fixtureAlt = location && typeof location.altitude_m === "number" ? location.altitude_m : null;
    if (action === "zoom_in") return { value: clampAltitude(fixtureAlt || ZOOM_IN_ALTITUDE_M, minAlt), source: fixtureAlt ? "gazetteer" : "action_default" };
    if (action === "zoom_out") return { value: clampAltitude(Math.max(ZOOM_OUT_ALTITUDE_M, (fixtureAlt || 0) * 2), minAlt), source: fixtureAlt ? "gazetteer" : "action_default" };
    return { value: clampAltitude(fixtureAlt || DEFAULT_ALTITUDE_M, minAlt), source: fixtureAlt ? "gazetteer" : "action_default" };
  }

  function parseSegment(text, segmentId, currentSeconds, frameRate = FRAME_RATE, previousLocation = null) {
    const warnings = [];
    const notes = [];
    const actionInfo = detectAction(text);
    if (actionInfo.warning) warnings.push(actionInfo.warning);

    // Strip modifiers front-to-back so the location extractor sees a clean phrase.
    let working = removeDurationPhrase(text);
    const tiltSpec = extractTiltSpec(working);
    working = tiltSpec.text;
    const orbitSpec = extractOrbitSpec(working);
    working = orbitSpec.text;
    const altitudeSpec = extractAltitudeSpec(working);
    working = altitudeSpec.text;

    let durationSeconds = extractDurationSeconds(text);
    let durationSource = "explicit";
    if (durationSeconds === null) {
      if (actionInfo.action !== "unresolved") {
        durationSeconds = DEFAULT_DURATION_S[actionInfo.action] || 4;
        durationSource = "action_default";
        notes.push(`no duration given — defaulted to ${durationSeconds}s.`);
      } else {
        durationSource = "missing";
        warnings.push("missing duration.");
      }
    }

    const locationPhrase = extractLocationPhrase(working, actionInfo.action);
    let location = locationPhrase ? resolveLocation(locationPhrase) : null;
    if (locationPhrase && !location) warnings.push(`unknown location fixture: ${locationPhrase}`);
    if (!locationPhrase) {
      if (previousLocation && actionInfo.action !== "unresolved") {
        location = { ...previousLocation, source: "carried_over" };
        notes.push(`location carried over: ${previousLocation.name}.`);
      } else {
        warnings.push("missing location.");
      }
    }

    const startSeconds = currentSeconds;
    const effectiveDuration = durationSeconds || 0;
    const endSeconds = startSeconds + effectiveDuration;
    const hasManualWarning = warnings.length > 0 || actionInfo.resolutionStatus === "manual_review";

    const altitude = targetAltitude(actionInfo.action, altitudeSpec, location);
    const segment = {
      segment_id: segmentId,
      source_text: cleanString(text),
      action: actionInfo.action,
      requested_action: actionInfo.action,
      location_name: location ? location.name : locationPhrase || "",
      location,
      altitude_m: altitude.value,
      altitude_source: altitude.source,
      tilt_deg: typeof tiltSpec.tilt_deg === "number" ? tiltSpec.tilt_deg : (DEFAULT_TILT_DEG[actionInfo.action] != null ? DEFAULT_TILT_DEG[actionInfo.action] : 45),
      tilt_source: typeof tiltSpec.tilt_deg === "number" ? "explicit" : "action_default",
      duration_source: durationSource,
      start_seconds: startSeconds,
      end_seconds: endSeconds,
      duration_seconds: effectiveDuration,
      start_frame: frameForSeconds(startSeconds, frameRate),
      end_frame: frameForSeconds(endSeconds, frameRate),
      resolution_status: hasManualWarning ? "manual_review" : "resolved",
      warnings,
      notes,
    };
    if (actionInfo.action === "orbit") {
      segment.orbit_degrees = typeof orbitSpec.orbit_degrees === "number" ? orbitSpec.orbit_degrees : 360;
      segment.orbit_direction = orbitSpec.orbit_direction || 1;
    }
    return { segment, nextSeconds: endSeconds, warnings, notes };
  }

  function parseDescription(description, options = {}) {
    const frameRate = options.frameRate || FRAME_RATE;
    const parts = splitSegments(description);
    const warnings = [];
    const notes = [];
    const segments = [];
    let currentSeconds = 0;
    let lastLocation = null;

    if (!parts.length) warnings.push("description did not contain any parseable segments.");

    parts.forEach((part, index) => {
      const parsed = parseSegment(part, index + 1, currentSeconds, frameRate, lastLocation);
      segments.push(parsed.segment);
      warnings.push(...parsed.warnings.map((warning) => `segment ${index + 1}: ${warning}`));
      notes.push(...parsed.notes.map((note) => `segment ${index + 1}: ${note}`));
      currentSeconds = parsed.nextSeconds;
      if (parsed.segment.location) lastLocation = parsed.segment.location;
    });

    return {
      source_description: cleanString(description),
      parser_strategy: "offline_regex_with_manual_review_fallback",
      frame_rate: frameRate,
      frame_convention: {
        start_frame: "inclusive",
        end_frame: "exclusive",
      },
      total_duration_seconds: currentSeconds,
      total_frames: frameForSeconds(currentSeconds, frameRate),
      segments,
      unresolved_items: segments
        .filter((segment) => segment.resolution_status !== "resolved")
        .map((segment) => ({
          segment_id: segment.segment_id,
          source_text: segment.source_text,
          warnings: [...segment.warnings],
        })),
      warnings,
      notes,
    };
  }

  function uniqueResolvedLocations(segments) {
    const locations = new Map();
    segments.forEach((segment) => {
      if (segment.location && segment.location.name) locations.set(segment.location.name, segment.location);
    });
    return Array.from(locations.values()).map((location) => ({
      name: location.name,
      latitude: location.latitude,
      longitude: location.longitude,
      resolution_status: "resolved_fixture",
    }));
  }

  function buildShotPlan(jobName, description, generatedAt = new Date().toISOString(), options = {}) {
    const parsed = parseDescription(description);
    let aspect = options.aspect || DEFAULT_ASPECT;
    const aspectWarnings = [];
    if (!ASPECTS[aspect]) {
      aspectWarnings.push(`unknown aspect "${aspect}" — using ${DEFAULT_ASPECT}.`);
      aspect = DEFAULT_ASPECT;
    }
    return {
      job_name: cleanString(jobName) || "Earth_Studio_Job",
      version: VERSION,
      generated_at: generatedAt,
      source_description: parsed.source_description,
      parser_strategy: parsed.parser_strategy,
      frame_rate: parsed.frame_rate,
      frame_convention: parsed.frame_convention,
      aspect,
      render_dimensions: { ...ASPECTS[aspect] },
      total_duration_seconds: parsed.total_duration_seconds,
      total_frames: parsed.total_frames,
      locations: uniqueResolvedLocations(parsed.segments),
      segments: parsed.segments,
      unresolved_items: parsed.unresolved_items,
      notes: parsed.notes,
      manual_earth_studio_steps: [
        "Open Google Earth Studio manually.",
        "Create or open the project manually; this planner does not log in, automate a browser, or control Earth Studio.",
        "Use shot-plan.json coordinates as manual camera/search references.",
        "Use route.kml only as a placemark/path reference asset.",
        "Manually create, review, and adjust all camera keyframes.",
        "Render manually only after Mikko reviews the camera move.",
      ],
      warnings: [
        "KML is a reference asset only and does not create a finished Google Earth Studio camera animation.",
        "Placemark use as camera targets is unverified in v1; manually search or set camera targets from shot-plan.json if needed.",
        "This planner does not render video, manipulate .esp files, control Google Earth Studio, or approve footage.",
        "Technical planning artifacts are not creative approval, rights clearance, or package-run evidence approval.",
        ...aspectWarnings,
        ...parsed.warnings,
      ],
    };
  }

  function buildReadme(plan) {
    return `# ${plan.job_name}

Local Google Earth Studio planning artifacts for a supervised manual build.

## Purpose

This folder converts a constrained text description into reviewable planning files for Google Earth Studio. It is for planning only.

## Not For

- Google login
- Browser automation
- Earth Studio control
- Render automation
- Approval markers
- Package-run state

## Manual Use

1. Review \`shot-plan.json\` and \`shot-plan.md\`.
2. Open Google Earth Studio manually.
3. Import \`earth-studio.esp\` (File > Import) and confirm the generated camera move, or search coordinates manually from \`shot-plan.json\`.
4. Optionally import or reference \`route.kml\` as placemark/path context.
5. Manually review and adjust all camera keyframes.

## Description grammar

Actions: fly to / hover over / orbit / zoom in on / zoom out from a place.
Chain with "then". Modifiers per segment: a duration ("for 5 seconds"),
an altitude ("at 800m", "from space", "low", "high"), a tilt ("top-down",
"tilted", "toward the horizon"), and for orbits an amount and direction
("twice", "180 degrees", "counterclockwise"). Segments without a location
reuse the previous one; segments without a duration get a sensible default.

KML is a reference asset only. It does not create a finished Google Earth Studio camera animation.
`;
  }

  function buildShotPlanMarkdown(plan) {
    const rows = plan.segments
      .map((segment) =>
        `| ${segment.segment_id} | ${segment.action} | ${segment.location_name || "manual review"} | ${segment.altitude_m} | ${segment.tilt_deg} | ${segment.start_seconds}-${segment.end_seconds}s | ${segment.start_frame} | ${segment.end_frame} | ${segment.resolution_status} |`
      )
      .join("\n");
    const locations = plan.locations.length
      ? plan.locations.map((location) => `- ${location.name}: ${location.latitude}, ${location.longitude}`).join("\n")
      : "- none resolved";
    const unresolved = plan.unresolved_items.length
      ? plan.unresolved_items
          .map((item) => `- Segment ${item.segment_id}: ${item.warnings.join("; ")}`)
          .join("\n")
      : "- none";
    const notes = (plan.notes || []).length
      ? plan.notes.map((note) => `- ${note}`).join("\n")
      : "- none";

    return `# Shot Plan: ${plan.job_name}

Total duration: ${plan.total_duration_seconds} seconds
Frame rate: ${plan.frame_rate} fps
Total frames: ${plan.total_frames}
Aspect: ${plan.aspect || DEFAULT_ASPECT} (${plan.render_dimensions ? `${plan.render_dimensions.width}x${plan.render_dimensions.height}` : "1920x1080"})
Frame convention: start_frame inclusive, end_frame exclusive

## Segment Table

| # | Action | Location | Alt (m) | Tilt | Time | start_frame | end_frame | Status |
|---|---|---|---:|---:|---:|---:|---:|---|
${rows}

## Locations

${locations}

## Applied Defaults

${notes}

## Unresolved Warnings

${unresolved}

## Manual Earth Studio Build Summary

- Use this plan as a manual camera-build guide.
- Use the coordinates in \`shot-plan.json\` for search or camera target reference.
- Use \`route.kml\` only as a visual reference asset.
- KML import does not create a finished Earth Studio camera animation.
- Mikko must manually create, review, adjust, and approve keyframes before rendering.
`;
  }

  function escapeXml(value) {
    return cleanString(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function kmlCoordinate(location) {
    return `${location.longitude},${location.latitude},0`;
  }

  function buildKml(plan) {
    const placemarks = plan.locations
      .map(
        (location) => `    <Placemark>
      <name>${escapeXml(location.name)}</name>
      <Point><coordinates>${kmlCoordinate(location)}</coordinates></Point>
    </Placemark>`
      )
      .join("\n");
    const pathCoordinates = plan.segments
      .filter((segment) => segment.location)
      .map((segment) => kmlCoordinate(segment.location))
      .join("\n        ");

    return `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <name>${escapeXml(plan.job_name)} route reference</name>
    <description>KML reference asset only. This does not create a finished Google Earth Studio camera animation.</description>
${placemarks}
    <Placemark>
      <name>${escapeXml(plan.job_name)} route path reference</name>
      <LineString>
        <tessellate>1</tessellate>
        <coordinates>
        ${pathCoordinates}
        </coordinates>
      </LineString>
    </Placemark>
  </Document>
</kml>
`;
  }

  function buildChecklist(plan) {
    return `# Earth Studio Build Checklist

## Before Building

- [ ] Review \`shot-plan.json\`.
- [ ] Confirm all unresolved/manual-review warnings are acceptable or repaired manually.
- [ ] Spot-check each resolved location's coordinates in shot-plan.json against a map.

## Manual Google Earth Studio Build

- [ ] Open Google Earth Studio manually.
- [ ] Create or open the project manually.
- [ ] Import \`earth-studio.esp\` and confirm the generated camera move, or build keyframes manually from \`shot-plan.json\`.
- [ ] Treat \`route.kml\` as placemark/path reference only.
- [ ] Confirm frame boundaries use start_frame inclusive and end_frame exclusive.

## Safety Boundary

- [ ] No Google login automation was used.
- [ ] No browser automation was used.
- [ ] No render automation was used.
- [ ] No package-run state or approval markers were written.

This checklist is technical planning support only. It is not creative approval, rights clearance, render approval, or package-run evidence approval.
`;
  }

  // ── Camera keyframe engine ─────────────────────────────────────────────────
  // Build a best-effort Google Earth Studio project (.esp) with camera
  // keyframes. Earth Studio is browser-only with no API, so this file cannot
  // be import-tested headlessly — it follows the documented .esp shape
  // (cameraPositionGroup + cameraRotationGroup keyframes) and must be
  // confirmed with one manual import. shot-plan.json / route.kml remain
  // reliable manual fallbacks.
  //
  // The engine walks resolved segments as a camera state machine
  // (lat/lng/alt/pan/tilt). Frame 0 is the START state of the first segment
  // (a zoom-in begins wide, a fly-to begins high), each later segment
  // continues from where the previous one ended, and tracks only get
  // keyframes when their value changes — with an anchor keyframe at the
  // segment start so a change never bleeds backwards through a hold.
  function espKeyframe(frame, value, transition = "linear") {
    return { time: Math.max(0, Math.round(frame)), value, transitionIn: { type: transition }, transitionOut: { type: transition } };
  }

  function toRadians(degrees) { return (degrees * Math.PI) / 180; }
  function round6(value) { return Math.round(value * 1e6) / 1e6; }
  function smoothstep(t) { return t * t * (3 - 2 * t); }

  function haversineMeters(a, b) {
    const R = 6371000;
    const dLat = toRadians(b.latitude - a.latitude);
    const dLng = toRadians(b.longitude - a.longitude);
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRadians(a.latitude)) * Math.cos(toRadians(b.latitude)) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
  }

  // Ground offset of a point at bearing/radius from a center (equirectangular
  // approximation — fine at orbit radii of a few km).
  function offsetPoint(center, bearingDeg, radiusM) {
    const bearing = toRadians(bearingDeg);
    const latitude = center.latitude + (radiusM / 111320) * Math.cos(bearing);
    const longitude = center.longitude + (radiusM / (111320 * Math.cos(toRadians(center.latitude)))) * Math.sin(bearing);
    return { latitude: round6(latitude), longitude: round6(longitude) };
  }

  // Where the camera starts when the plan opens with this segment.
  function initialCameraState(segment, endAltitude, tilt) {
    const location = segment.location;
    const minAlt = location.min_altitude_m || 0;
    const state = { latitude: location.latitude, longitude: location.longitude, altitude: endAltitude, pan: 0, tilt };
    if (segment.action === "fly_to") {
      // Establishing dive: begin high above the target and descend into it.
      state.altitude = clampAltitude(Math.min(Math.max(endAltitude * 4, 10000), 2500000), minAlt);
    } else if (segment.action === "zoom_in") {
      state.altitude = clampAltitude(Math.max(endAltitude * 3, DEFAULT_ALTITUDE_M), minAlt);
    } else if (segment.action === "zoom_out") {
      state.altitude = clampAltitude(Math.min(DEFAULT_ALTITUDE_M, Math.max(600, endAltitude / 3)), minAlt);
    } else if (segment.action === "orbit") {
      // Begin already on the orbit circle, facing the target.
      const radius = orbitRadiusMeters(endAltitude, tilt);
      const start = offsetPoint(location, 0, radius);
      state.latitude = start.latitude;
      state.longitude = start.longitude;
      state.pan = 180;
    }
    return state;
  }

  // A tilted camera at altitude A looking at the target sits roughly
  // A*tan(tilt) away on the ground. Top-down (tilt 0) degenerates to a
  // spin-in-place, which is exactly the top-down orbit look.
  function orbitRadiusMeters(altitude, tiltDeg) {
    const tilt = Math.min(Math.max(tiltDeg, 0), 80);
    return Math.min(altitude * Math.tan(toRadians(tilt)), 80000);
  }

  function buildEspKeyframes(plan) {
    const tracks = { lng: [], lat: [], alt: [], pan: [], tilt: [] };
    const put = (trackName, frame, value) => {
      const track = tracks[trackName];
      const kf = espKeyframe(frame, value);
      if (track.length && track[track.length - 1].time === kf.time) track[track.length - 1] = kf;
      else if (!track.length || track[track.length - 1].time < kf.time) track.push(kf);
    };
    const last = (trackName) => (tracks[trackName].length ? tracks[trackName][tracks[trackName].length - 1] : null);
    // Move a track to `value` across [startFrame, endFrame], anchoring the old
    // value at startFrame so the change does not bleed back through a hold.
    const change = (trackName, startFrame, endFrame, value) => {
      const previous = last(trackName);
      if (previous && previous.value === value) return;
      if (previous && previous.time < startFrame) put(trackName, startFrame, previous.value);
      put(trackName, endFrame, value);
    };
    const anchor = (trackName, startFrame) => {
      const previous = last(trackName);
      if (previous && previous.time < startFrame) put(trackName, startFrame, previous.value);
    };

    const resolved = plan.segments.filter((s) => s.location && s.duration_seconds > 0);
    if (!resolved.length) return tracks;

    let state = null;
    resolved.forEach((segment) => {
      const location = segment.location;
      const minAlt = location.min_altitude_m || 0;
      const endAltitude = clampAltitude(segment.altitude_m || DEFAULT_ALTITUDE_M, minAlt);
      const tilt = typeof segment.tilt_deg === "number" ? segment.tilt_deg : 45;
      const sf = segment.start_frame;
      const ef = segment.end_frame;

      if (!state) {
        state = initialCameraState(segment, endAltitude, tilt);
        put("lng", sf, state.longitude);
        put("lat", sf, state.latitude);
        put("alt", sf, state.altitude);
        put("pan", sf, state.pan);
        put("tilt", sf, state.tilt);
      }

      if (segment.action === "orbit") {
        const sweep = (segment.orbit_degrees || 360) * (segment.orbit_direction || 1);
        const radius = orbitRadiusMeters(endAltitude, tilt);
        // Enter the circle at the bearing the camera is already facing away
        // from, so the pan track stays continuous (fixes the orbit-after-orbit
        // static bug: each orbit adds its sweep to the accumulated pan).
        const theta0 = state.pan - 180;
        const sampleCount = Math.max(4, Math.ceil(Math.abs(sweep) / 30));
        anchor("lng", sf);
        anchor("lat", sf);
        let lastPoint = { latitude: state.latitude, longitude: state.longitude };
        for (let i = 1; i <= sampleCount; i += 1) {
          const t = i / sampleCount;
          lastPoint = offsetPoint(location, theta0 + sweep * t, radius);
          const frame = sf + (ef - sf) * t;
          put("lat", frame, lastPoint.latitude);
          put("lng", frame, lastPoint.longitude);
        }
        change("alt", sf, ef, endAltitude);
        change("tilt", sf, ef, tilt);
        change("pan", sf, ef, state.pan + sweep);
        state = { latitude: lastPoint.latitude, longitude: lastPoint.longitude, altitude: endAltitude, pan: state.pan + sweep, tilt };
        return;
      }

      // fly_to / hover / zoom_in / zoom_out: move (or hold) position, with an
      // eased altitude profile and a cinematic arc on long flights.
      const distance = haversineMeters(state, location);
      const arcBump = segment.action === "fly_to" && distance > 30000 ? Math.min(distance * 0.35, 2500000) : 0;
      if (arcBump || state.altitude !== endAltitude) {
        anchor("alt", sf);
        [0.25, 0.5, 0.75].forEach((t) => {
          const eased = state.altitude + (endAltitude - state.altitude) * smoothstep(t);
          put("alt", sf + (ef - sf) * t, Math.round(clampAltitude(eased + arcBump * Math.sin(Math.PI * t), minAlt)));
        });
        put("alt", ef, endAltitude);
      }
      change("lng", sf, ef, location.longitude);
      change("lat", sf, ef, location.latitude);
      change("tilt", sf, ef, tilt);
      state = { latitude: location.latitude, longitude: location.longitude, altitude: endAltitude, pan: state.pan, tilt };
    });
    return tracks;
  }

  // ── Real .esp serialization ────────────────────────────────────────────────
  // The v0.4 .esp was a from-scratch guess and REAL Earth Studio refused to
  // import it (observed 2026-08-07, round 1 of the acceptance run). This
  // serializer follows the reverse-engineered project format that is known to
  // import: mkatzef/google-studio-utils (esp_template.esp + kml_to_esp.py,
  // modelVersion 17). Key facts from that reference, all empirical:
  //   - envelope: { modelVersion, settings{name,frameRate,dimensions,duration,
  //     timeFormat:"frames"}, scenes[…], playbackManager{range} }
  //   - keyframe `time` is a FRACTION [0,1] of the scene duration
  //   - keyframes sit BESIDE `value` ({ type, value:{…}, keyframes, intimeline })
  //   - keyframe values are normalized: longitude v = (lon−min)/(180−min) with
  //     value.minValueRange = min; latitude likewise against 90; altitude
  //     v = meters × 1.5356706349899208e-08; pan normalized against explicit
  //     min/maxValueRange; tilt v = degrees/180
  //   - rotationX = PAN/heading, rotationY = TILT (0 = straight down) — the
  //     opposite of the v0.4 guess
  //   - attributes with no keyframes are static: { type, value: {} }
  const ESP_MODEL_VERSION = 17;
  const ESP_ALTITUDE_SCALE = 1.5356706349899208e-08; // meters → ES altitude value (empirical)

  function espLeaf(type, keyframes, valueMeta = {}) {
    if (!keyframes || !keyframes.length) return { type, value: { ...valueMeta } };
    return { type, value: { relative: 0, ...valueMeta }, keyframes, intimeline: true };
  }

  function buildEsp(plan, options = {}) {
    const dims = plan.render_dimensions || ASPECTS[plan.aspect] || ASPECTS[DEFAULT_ASPECT];
    const width = options.width || dims.width;
    const height = options.height || dims.height;
    const totalFrames = Math.max(1, plan.total_frames || 1);
    const tracks = buildEspKeyframes(plan);
    const frac = (frame) => Math.min(1, Math.max(0, frame / totalFrames));
    const kfs = (arr, mapValue) => arr.map((k) => ({ time: frac(k.time), value: mapValue(k.value) }));
    const values = (arr) => arr.map((k) => k.value);

    const lngVals = values(tracks.lng);
    const latVals = values(tracks.lat);
    const panVals = values(tracks.pan);
    const lonMin = lngVals.length ? Math.min(...lngVals) : 0;
    const lonSpan = (180 - lonMin) || 360;
    const latMin = latVals.length ? Math.min(...latVals) : 0;
    const latSpan = (90 - latMin) || 180;
    const panMin = panVals.length ? Math.min(...panVals) : 0;
    const panSpan = (panVals.length ? Math.max(...panVals) - panMin : 0) || 360;

    return {
      modelVersion: ESP_MODEL_VERSION,
      settings: {
        name: plan.job_name,
        frameRate: plan.frame_rate,
        dimensions: { width, height },
        duration: totalFrames,
        timeFormat: "frames",
      },
      scenes: [
        {
          world: { kmls: [] },
          animationModel: { roving: false, logarithmic: false, groupedPosition: true },
          duration: totalFrames,
          attributes: [
            {
              type: "cameraGroup",
              inTimeline: true,
              attributes: [
                {
                  type: "cameraPositionGroup",
                  inTimeline: true,
                  attributes: [
                    espLeaf("longitude", kfs(tracks.lng, (v) => (v - lonMin) / lonSpan), { minValueRange: lonMin }),
                    espLeaf("latitude", kfs(tracks.lat, (v) => (v - latMin) / latSpan), { minValueRange: latMin }),
                    espLeaf("altitude", kfs(tracks.alt, (v) => v * ESP_ALTITUDE_SCALE), { logarithmic: false }),
                  ],
                },
                {
                  type: "cameraTargetEffect",
                  attributes: [
                    { type: "enabled", value: {} },
                    {
                      type: "poi",
                      attributes: [
                        { type: "longitudePOI", value: {} },
                        { type: "latitudePOI", value: {} },
                        { type: "altitudePOI", value: { logarithmic: false } },
                      ],
                    },
                    { type: "influence", value: {} },
                  ],
                },
                {
                  type: "cameraRotationGroup",
                  inTimeline: true,
                  attributes: [
                    espLeaf("rotationX", kfs(tracks.pan, (v) => (v - panMin) / panSpan),
                      tracks.pan.length ? { minValueRange: panMin, maxValueRange: panMin + panSpan } : {}),
                    espLeaf("rotationY", kfs(tracks.tilt, (v) => v / 180)),
                    { type: "rotationZ", value: {} },
                  ],
                },
                {
                  type: "cameraLensGroup",
                  attributes: [
                    { type: "fov", value: {} },
                    { type: "exposure", value: {} },
                    { type: "aperture", value: {} },
                    { type: "minFocusLength", value: {} },
                  ],
                },
              ],
            },
            {
              type: "environmentGroup",
              attributes: [
                {
                  type: "sunGroup",
                  attributes: [
                    { type: "sunVisibility", value: {} },
                    { type: "worldTime", value: { relative: 0.5 } },
                  ],
                },
                {
                  type: "cloudGroup",
                  attributes: [
                    { type: "cloudVisibility", value: {} },
                    { type: "cloudopacity", value: {} },
                    { type: "cloudheight", value: {} },
                    { type: "clouddate", value: {} },
                  ],
                },
                { type: "starsPlanetsGroup", attributes: [{ type: "starsEnabled", value: {} }] },
                {
                  type: "seawaterGroup",
                  attributes: [
                    { type: "seawater", value: {} },
                    { type: "influence", value: { relative: 1 } },
                  ],
                },
                { type: "buildingsEnabled", value: {} },
              ],
            },
          ],
          cameraExport: { logarithmic: false, modelVersion: 2 },
        },
      ],
      playbackManager: { range: { start: 0, end: totalFrames } },
    };
  }

  function buildArtifacts(jobName, description, generatedAt, options = {}) {
    const plan = buildShotPlan(jobName, description, generatedAt, options);
    return {
      "README.md": buildReadme(plan),
      "shot-plan.json": `${JSON.stringify(plan, null, 2)}\n`,
      "shot-plan.md": buildShotPlanMarkdown(plan),
      "route.kml": buildKml(plan),
      "earth-studio-build-checklist.md": buildChecklist(plan),
      "earth-studio.esp": `${JSON.stringify(buildEsp(plan), null, 2)}\n`,
    };
  }

  function expectedFiles() {
    return [...EXPECTED_FILES];
  }

  function validateShotPlanPayload(payload) {
    const errors = [];
    [
      "job_name",
      "version",
      "generated_at",
      "source_description",
      "parser_strategy",
      "frame_rate",
      "frame_convention",
      "total_duration_seconds",
      "total_frames",
      "locations",
      "segments",
      "unresolved_items",
      "manual_earth_studio_steps",
      "warnings",
    ].forEach((key) => {
      if (!Object.hasOwn(payload || {}, key)) errors.push(`missing shot-plan field: ${key}`);
    });
    if (payload && payload.frame_rate !== FRAME_RATE) errors.push("frame_rate must be 30");
    if (payload && payload.frame_convention) {
      if (payload.frame_convention.start_frame !== "inclusive") errors.push("start_frame convention must be inclusive");
      if (payload.frame_convention.end_frame !== "exclusive") errors.push("end_frame convention must be exclusive");
    }
    // aspect is optional (plans predating v0.4 have none) but must be known when present.
    if (payload && payload.aspect !== undefined && !ASPECTS[payload.aspect]) errors.push(`unknown aspect: ${payload.aspect}`);
    if (!Array.isArray(payload && payload.segments) || payload.segments.length === 0) errors.push("segments must be populated");
    (payload && payload.segments || []).forEach((segment, index) => {
      ["segment_id", "action", "start_seconds", "end_seconds", "duration_seconds", "start_frame", "end_frame", "resolution_status"].forEach((key) => {
        if (!Object.hasOwn(segment, key)) errors.push(`segment ${index + 1} missing ${key}`);
      });
      if (segment.end_frame < segment.start_frame) errors.push(`segment ${index + 1} has invalid frame boundary`);
    });
    (payload && payload.locations || []).forEach((location) => {
      const lat = Number(location && location.latitude);
      const lng = Number(location && location.longitude);
      if (!Number.isFinite(lat) || lat < -90 || lat > 90) errors.push(`location ${location && location.name}: latitude out of range`);
      if (!Number.isFinite(lng) || lng < -180 || lng > 180) errors.push(`location ${location && location.name}: longitude out of range`);
    });
    return errors;
  }

  const api = {
    DEFAULT_OUTPUT_DIR,
    VERSION,
    FRAME_RATE,
    DEFAULT_ALTITUDE_M,
    MIN_ALTITUDE_M,
    MAX_ALTITUDE_M,
    SPACE_ALTITUDE_M,
    DEFAULT_DURATION_S,
    DEFAULT_TILT_DEG,
    ASPECTS,
    DEFAULT_ASPECT,
    LOCATION_FIXTURES,
    LOCATION_ALIASES,
    splitSegments,
    extractDurationSeconds,
    extractAltitudeSpec,
    extractTiltSpec,
    extractOrbitSpec,
    detectAction,
    extractLocationPhrase,
    normalizeLocationName,
    resolveLocation,
    parseExplicitCoords,
    parseDescription,
    buildShotPlan,
    buildArtifacts,
    buildKml,
    buildShotPlanMarkdown,
    buildEspKeyframes,
    buildEsp,
    expectedFiles,
    validateShotPlanPayload,
    haversineMeters,
    orbitRadiusMeters,
    slugify,
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  } else {
    globalScope.EarthStudioJobPlanner = api;
  }
})(typeof window !== "undefined" ? window : globalThis);
