/** Original scenery, kept decorative so the terminal remains the reading order. */
export function NightScene() {
  return (
    <div className="night-scene" aria-hidden="true">
      <div className="night-stars" />
      <div className="night-haze" />
      <div className="night-moon">
        <svg viewBox="0 0 120 120" fill="none">
          <defs>
            <radialGradient id="moon-body" cx="42%" cy="38%" r="72%">
              <stop offset="0" stopColor="#f2f5e9" />
              <stop offset=".42" stopColor="#d8e2d9" />
              <stop offset=".74" stopColor="#a9bfc6" />
              <stop offset="1" stopColor="#7b95a8" />
            </radialGradient>
            <radialGradient id="moon-limb" cx="50%" cy="50%" r="50%">
              <stop offset=".78" stopColor="#31435c" stopOpacity="0" />
              <stop offset="1" stopColor="#31435c" stopOpacity=".38" />
            </radialGradient>
            <filter id="moon-soft" x="-40%" y="-40%" width="180%" height="180%">
              <feGaussianBlur stdDeviation="2.6" />
            </filter>
          </defs>
          <circle cx="60" cy="60" r="44" fill="url(#moon-body)" />
          <g filter="url(#moon-soft)" fill="#77909f">
            <ellipse cx="48" cy="46" rx="15" ry="11" opacity=".3" />
            <ellipse cx="72" cy="70" rx="12" ry="9" opacity=".26" />
            <ellipse cx="62" cy="38" rx="7" ry="5" opacity=".22" />
            <ellipse cx="44" cy="74" rx="8" ry="6" opacity=".24" />
            <ellipse cx="80" cy="50" rx="6" ry="8" opacity=".2" />
          </g>
          <circle cx="60" cy="60" r="44" fill="url(#moon-limb)" />
        </svg>
      </div>
      <svg
        className="night-mountains"
        viewBox="0 0 1600 600"
        preserveAspectRatio="xMidYMax slice"
        fill="none"
      >
        <defs>
          <filter id="ridge-far" x="-5%" y="-5%" width="110%" height="110%">
            <feGaussianBlur stdDeviation="5" />
          </filter>
          <filter id="ridge-mid" x="-5%" y="-5%" width="110%" height="110%">
            <feGaussianBlur stdDeviation="2.4" />
          </filter>
          <filter id="ridge-near" x="-5%" y="-5%" width="110%" height="110%">
            <feGaussianBlur stdDeviation=".8" />
          </filter>
          <filter id="ridge-light" x="-30%" y="-30%" width="160%" height="160%">
            <feGaussianBlur stdDeviation="7" />
          </filter>
          <linearGradient id="haze-band" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#8fa9c4" stopOpacity="0" />
            <stop offset="1" stopColor="#8fa9c4" stopOpacity=".16" />
          </linearGradient>
        </defs>
        {/* Farthest ridge: pale, cold, dissolved into the sky. */}
        <path
          d="M0 330 105 262 163 292 318 118 430 255 511 201 614 296 760 172 838 234 907 188 1049 316 1160 228 1266 282 1403 138 1527 276 1600 238V600H0Z"
          fill="#5d7592"
          opacity=".5"
          filter="url(#ridge-far)"
        />
        {/* Moonlit crests on the far ridge, facing the moon. */}
        <path
          d="m318 118 112 137m318-83 78 73m546-107 124 156m-879 2 89-95"
          stroke="#c7d8e4"
          strokeWidth="7"
          strokeLinecap="round"
          opacity=".34"
          filter="url(#ridge-light)"
        />
        <rect x="0" y="270" width="1600" height="120" fill="url(#haze-band)" />
        {/* Middle ridge. */}
        <path
          d="M0 410 121 355 208 389 375 271 522 371 656 305 813 404 929 297 1028 348 1140 316 1276 389 1456 284 1600 342V600H0Z"
          fill="#31465f"
          opacity=".78"
          filter="url(#ridge-mid)"
        />
        <path
          d="m375 271 147 100m407-74 99 51m428-64 144 58"
          stroke="#a9bfcf"
          strokeWidth="6"
          strokeLinecap="round"
          opacity=".22"
          filter="url(#ridge-light)"
        />
        <rect x="0" y="370" width="1600" height="110" fill="url(#haze-band)" />
        {/* Near ridge: darkest, sharpest. */}
        <path
          d="M0 485 153 439 304 473 475 411 629 483 778 449 943 476 1128 416 1300 460 1468 400 1600 447V600H0Z"
          fill="#152438"
          opacity=".94"
          filter="url(#ridge-near)"
        />
        {/* Ground mist pooling over the foothills. */}
        <rect
          x="0"
          y="430"
          width="1600"
          height="130"
          fill="#a9c2d6"
          opacity=".07"
          filter="url(#ridge-far)"
        />
        <path
          d="m0 580 198-45 170 33 235-35 169 45 232-31 234 25 194-34 168 28v34H0Z"
          fill="#0a1322"
        />
      </svg>
      <svg className="night-ruins ruins-left" viewBox="0 0 190 580" fill="none">
        <path
          d="M8 579V510H25V213L15 201V170L32 166 40 149 55 156 63 141 85 147 95 170H123V198L111 211V510H134V548H167V580Z"
          fill="#1d2833"
        />
        <path
          d="M25 213h86v16H25Zm-10-34h108v12H15ZM8 516h126v13H8Z"
          fill="#4d5c66"
          opacity=".4"
        />
        <path
          d="M39 235v262m17-262v262m18-262v262m18-262v262"
          stroke="#0e1826"
          strokeWidth="6"
        />
        <path
          d="m34 310 29 14-9 44 29 13M49 449l43 16"
          stroke="#0e1826"
          strokeWidth="3"
        />
        <path
          d="m111 213-12 22v262l12 13M26 173l25-7 31 8"
          stroke="#93a5b4"
          strokeOpacity=".22"
          strokeWidth="3"
        />
        <path d="m113 579 8-47 23-10 18 21 19 7 9 29" fill="#28333d" />
      </svg>
      <svg
        className="night-ruins ruins-right"
        viewBox="0 0 220 650"
        fill="none"
      >
        <path
          d="M17 650V599H38V184L24 170V145H53L61 132 86 137 95 124 113 144H148V171L133 184V599H157V627H180V650Z"
          fill="#232e39"
        />
        <path
          d="M38 185h95v18H38ZM24 152h124v12H24ZM17 603h140v14H17Z"
          fill="#5a686f"
          opacity=".36"
        />
        <path
          d="M51 216v367m22-367v367m22-367v367m22-367v367"
          stroke="#121d2c"
          strokeWidth="7"
        />
        <path
          d="m39 306 28 29-12 33 37 22M86 500l46 17"
          stroke="#0e1826"
          strokeWidth="3"
        />
        <path d="M164 650V428l-8-13v-21l27-8 30 9v255" fill="#18232f" />
        <path
          d="M164 420h56m-46 20v190m22-190v190"
          stroke="#39464f"
          strokeWidth="5"
        />
      </svg>
    </div>
  );
}
