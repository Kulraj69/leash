/** Original scenery, kept decorative so the terminal remains the reading order. */
export function NightScene() {
  return (
    <div className="night-scene" aria-hidden="true">
      <div className="night-stars" />
      <div className="night-moon">
        <svg viewBox="0 0 80 80" fill="none">
          <defs>
            <radialGradient id="moon-light">
              <stop stopColor="#e5ecd7" />
              <stop offset=".8" stopColor="#b9cdd0" />
              <stop offset="1" stopColor="#7898b0" />
            </radialGradient>
          </defs>
          <circle cx="40" cy="40" r="32" fill="url(#moon-light)" />
          <path
            d="M27 17c-8 9-10 18-6 31s18 22 32 20C38 70 20 59 14 47S13 25 27 17Z"
            fill="#92aebd"
            opacity=".6"
          />
          <circle cx="48" cy="25" r="7" fill="#809eac" opacity=".25" />
          <circle cx="29" cy="44" r="9" fill="#91a9b3" opacity=".3" />
          <circle cx="53" cy="51" r="5" fill="#809eac" opacity=".3" />
        </svg>
      </div>
      <svg
        className="night-mountains"
        viewBox="0 0 1600 600"
        preserveAspectRatio="xMidYMax slice"
        fill="none"
      >
        <path
          d="M0 310 105 228 163 266 318 74 430 221 511 163 614 273 760 131 838 204 907 151 1049 300 1160 195 1266 258 1403 98 1527 254 1600 209V600H0Z"
          fill="#233957"
        />
        <path
          d="m105 228 58 38L318 74l112 147-66-48-22 22-26-69-43 78-19-10-60 101-34-12Zm509 45 146-142 78 73-59-31-17-12-48 62-14-16Zm546-78 106 63 137-160 124 156-102-85-23-42-35 65-20-6-70 96Z"
          fill="#9bafb7"
          opacity=".68"
        />
        <path
          d="m318 74-13 152-61 90 87-72 33-71-22 22-26-69-43 78-19-10-60 101-31-29Zm1085 24-21 175-64 79 99-78 8-105-23-42-35 65-20-6-70 96Z"
          fill="#536e89"
        />
        <path
          d="M0 410 121 355 208 389 375 271 522 371 656 305 813 404 929 297 1028 348 1140 316 1276 389 1456 284 1600 342V600H0Z"
          fill="#12223c"
        />
        <path
          d="M0 485 153 439 304 473 475 411 629 483 778 449 943 476 1128 416 1300 460 1468 400 1600 447V600H0Z"
          fill="#0b1529"
        />
        <path
          d="m0 580 198-45 170 33 235-35 169 45 232-31 234 25 194-34 168 28v34H0Z"
          fill="#080f20"
        />
      </svg>
      <svg className="night-ruins ruins-left" viewBox="0 0 190 580" fill="none">
        <path
          d="M8 579V510H25V213L15 201V170L32 166 40 149 55 156 63 141 85 147 95 170H123V198L111 211V510H134V548H167V580Z"
          fill="#26333e"
        />
        <path
          d="M25 213h86v16H25Zm-10-34h108v12H15ZM8 516h126v13H8Z"
          fill="#62717a"
          opacity=".55"
        />
        <path
          d="M39 235v262m17-262v262m18-262v262m18-262v262"
          stroke="#111c2d"
          strokeWidth="6"
        />
        <path
          d="m34 310 29 14-9 44 29 13M49 449l43 16"
          stroke="#111c2d"
          strokeWidth="3"
        />
        <path
          d="m111 213-12 22v262l12 13M26 173l25-7 31 8"
          stroke="#a5aca0"
          strokeOpacity=".3"
          strokeWidth="3"
        />
        <path d="m113 579 8-47 23-10 18 21 19 7 9 29" fill="#35404a" />
      </svg>
      <svg
        className="night-ruins ruins-right"
        viewBox="0 0 220 650"
        fill="none"
      >
        <path
          d="M17 650V599H38V184L24 170V145H53L61 132 86 137 95 124 113 144H148V171L133 184V599H157V627H180V650Z"
          fill="#2e3942"
        />
        <path
          d="M38 185h95v18H38ZM24 152h124v12H24ZM17 603h140v14H17Z"
          fill="#758286"
          opacity=".5"
        />
        <path
          d="M51 216v367m22-367v367m22-367v367m22-367v367"
          stroke="#172335"
          strokeWidth="7"
        />
        <path
          d="m39 306 28 29-12 33 37 22M86 500l46 17"
          stroke="#111c2d"
          strokeWidth="3"
        />
        <path d="M164 650V428l-8-13v-21l27-8 30 9v255" fill="#1e2a38" />
        <path
          d="M164 420h56m-46 20v190m22-190v190"
          stroke="#43515c"
          strokeWidth="5"
        />
      </svg>
    </div>
  );
}
