# Changelog

## [0.2.0](https://github.com/sandaun/maps-webapp/compare/maps-web-v0.1.0...maps-web-v0.2.0) (2026-08-31)


### ✨ Features

* abbreviate compact-mode signal cell values ([6a3bd46](https://github.com/sandaun/maps-webapp/commit/6a3bd46552e5e7c70785516627368d5c7dbbbc19))
* add a compact signals grid with abbreviated headers ([fd5e363](https://github.com/sandaun/maps-webapp/commit/fd5e363bdd0873921fab1b0a82feda886bb36a10))
* add connection, diagnostics and deploy screens with receive flow ([05e7caa](https://github.com/sandaun/maps-webapp/commit/05e7caaca05c4a6e5bac023b3287a78ef4a8e5dd))
* add deterministic xbl generator with byte-exact verification harness ([c179cc4](https://github.com/sandaun/maps-webapp/commit/c179cc47c40ef923fa6067ee7e69f9d2e304b4b4))
* add gated deploy path with xmodem sender and sendcmplt support ([3f324a6](https://github.com/sandaun/maps-webapp/commit/3f324a6e60ca513c20b8ab541b280d5b839e7326))
* add intesis gateway transport with session, discovery and read-only api ([12de17c](https://github.com/sandaun/maps-webapp/commit/12de17c40cbfa2246062977030912c6c01b1c589))
* add knx-mbm domain model, xml patch ops and validation ([a2cddfc](https://github.com/sandaun/maps-webapp/commit/a2cddfcdfae5f6026b089d96b16a72830c63c2fe))
* add local persistence, project service and demo mode api ([0f5e10a](https://github.com/sandaun/maps-webapp/commit/0f5e10a11102cf21e8efaf2b0072a6f832847ae5))
* add me-mbs family domain with modbus slave and mitsubishi electric protocols ([436330e](https://github.com/sandaun/maps-webapp/commit/436330e51e76c399b958a2f34df1063bff6e1a7b))
* add me-mbs xbl generator verified byte-exact against real fixture ([be30fbf](https://github.com/sandaun/maps-webapp/commit/be30fbf6568df6ca3df153de374509662740ca21))
* add project screens with signals table, devices crud and validation panel ([abbfc15](https://github.com/sandaun/maps-webapp/commit/abbfc15dca6b044c25927b1520ca0b08a804809a))
* add project-format core with byte-stable ibmaps round-trip ([cf3de38](https://github.com/sandaun/maps-webapp/commit/cf3de38ada9619f62c2933071a488a0f74cd9e5c))
* add projects workspace and creation flow ([3078c40](https://github.com/sandaun/maps-webapp/commit/3078c40a92c827049d5dfcffcaf4503e427689eb))
* add receive-project script and capture first real 770 air fixture ([2c7e46c](https://github.com/sandaun/maps-webapp/commit/2c7e46ca61cb022c695cdc32a6252d5da57351a0))
* add Signals V9 chrome and desktop import/export formats ([6cdb792](https://github.com/sandaun/maps-webapp/commit/6cdb792603bed64da89207d9eb29595dad548b27))
* add unicast discovery targets for nat networks and fix netdhcp parsing ([287958b](https://github.com/sandaun/maps-webapp/commit/287958ba007e7b5ab523721f221706b4fd51e4ca))
* align workspace status header with v8 design ([342abe4](https://github.com/sandaun/maps-webapp/commit/342abe454fbf283d2ff6c1b7ec5bf0d143f1b734))
* complete new-project sources and lighten type ([6f94c6e](https://github.com/sandaun/maps-webapp/commit/6f94c6e8fc52adee6a4bba3da5ce2f9464e329ed))
* integrate sidebar collapse with live gateway state ([c989bb3](https://github.com/sandaun/maps-webapp/commit/c989bb35c011cd9922fea1e4807f0b8797342e42))
* keep workspace gateway chrome live ([0e19c60](https://github.com/sandaun/maps-webapp/commit/0e19c608036e729ec5d977a6d2b05132029ce4d2))
* replace signal drawers with shared inline grid ([f047a55](https://github.com/sandaun/maps-webapp/commit/f047a558eed1af8e7a425fae3b23ca088d9d0310))
* scaffold maps-web app shell and add knx-mbm audit doc ([513dda1](https://github.com/sandaun/maps-webapp/commit/513dda1b4d190123097eb826890be856f52bd59e))
* signals V9 UI alignment ([56f592b](https://github.com/sandaun/maps-webapp/commit/56f592bf026469f0cee517d18430c2e307578e93))
* **signals:** improve dropdown editing ([a003010](https://github.com/sandaun/maps-webapp/commit/a003010248f8f096789b3849fd7be13761446e98))
* wire me-mbs family into api and screens with family registry ([497882b](https://github.com/sandaun/maps-webapp/commit/497882b73c8dfd7d72f47ff2d6ddb4ffec52014f))


### 🐛 Bug Fixes

* align header protocol chip height with status chips ([7c4ab5e](https://github.com/sandaun/maps-webapp/commit/7c4ab5e307059b05ccf24e83ad39e3d7ddfa183e))
* anchor sidebar collapse in the brand row ([0ab62c5](https://github.com/sandaun/maps-webapp/commit/0ab62c5d850b66fdd4d1b275236a63e7458d459e))
* drop redundant divider under the MAPS rail title ([dc0f5d3](https://github.com/sandaun/maps-webapp/commit/dc0f5d39fc69958285660a25fcf90791808f5744))
* fit signal column widths to headers and keep Reset widths visible ([8a031dd](https://github.com/sandaun/maps-webapp/commit/8a031dd1dc3af4ae13e6d12638801585692ae774))
* preload application fonts without reload flash ([90b500e](https://github.com/sandaun/maps-webapp/commit/90b500ecbd57b804a461f74c6f985e91ab2aa499))
* **signals:** align grid colors with V9 ([e9e2d36](https://github.com/sandaun/maps-webapp/commit/e9e2d361f18c0952d73e57f97ffa03d61271b5cf))
* spell out Mitsubishi Electric signal band ([f37e77a](https://github.com/sandaun/maps-webapp/commit/f37e77abf363eb2f0fc9af21f30632c7000fa455))
* **ui:** align remaining views with V9 ([a93f341](https://github.com/sandaun/maps-webapp/commit/a93f341848b81bbd2bd490beddec8ac26b306d9a))
* **ui:** align typography with V9 ([4f6cade](https://github.com/sandaun/maps-webapp/commit/4f6cadee0cb35971c6565688ebedc8ece1fd4eca))
* use the collapsed brand mark as sidebar control ([d591d01](https://github.com/sandaun/maps-webapp/commit/d591d0198d6e423d28cbdcdab383f141202a0000))


### ♻️ Refactors

* **signals:** sync tab state from the url during render ([e949f29](https://github.com/sandaun/maps-webapp/commit/e949f2985081ddc90d257d133016ef2f1a9c00e5))
