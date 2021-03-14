/*

    GoogleMapsPolygon
    ========================

    @file      : GoogleMapsPolygon.js
    @version   : 2.4.0
    @author    : Ivo Sturm
    @date      : 13-3-2021
    @copyright : First Consulting
    @license   : Apache v2

    Documentation
    ========================
	
	Releases
	========================
	v1.0 	Initial release. A widget for plotting Google Polygons and Polylines on a Google Map.
	v2.0	Added drawing and editing when a new object is created and editing when looking at a single object (dataview)
	v2.1	Added fix for redrawing the map with objects when a contextentity, not being the polygon entity is changed and polygon entities are associated to it.
	v2.2	Mendix 8 upgrade
	v2.3	Added setZoom(this.lowestZoom) to use case where only one object is plotted via overruleFitBounds setting from Studio Pro
			Added LineType + LineStrokeWeight for Polylines. Added opacity for polygons. 
			Some jsHint fixes. 
	v2.4	Added extra support for coordinates arrays with square brackets in stead of normal brackets. These typically are seen in geoJSON formats.
*/

define([
    'dojo/_base/declare',
	"mxui/dom",
	"dojo/dom",	
	"dojo/on",
	'mxui/widget/_WidgetBase', 
	'dijit/_TemplatedMixin',
    'dojo/dom-style', 
	'dojo/dom-construct', 
	'dojo/_base/array', 
	'dojo/_base/lang',
    'GoogleMapsPolygon/lib/jsapi', 
	'dojo/text!GoogleMapsPolygon/widget/template/GoogleMapsPolygon.html'
], function (declare, dom, dojoDom, on,_WidgetBase, _TemplatedMixin, domStyle, domConstruct, dojoArray, lang, googleMaps, widgetTemplate) {
    'use strict';

    return declare('GoogleMapsPolygon.widget.GoogleMapsPolygon', [_WidgetBase, _TemplatedMixin], {
        templateString: widgetTemplate,
		
		_progressID: null,
		_objectsArr: [],
		_objects: [],
		_handle: null,
        _contextObj: null,
        _googleMap: null,
        _objectCache: null,
        _googleScript: null,
        _defaultPosition: null,
		_splits	: {},
		_refs : null,
		_schema : [],
		_infowindow: null,
		_logNode: 'GoogleMapsPolygon widget: ',
		_resizeTimer: null,
		_drawingManager: null,
		_selectedShape: null,
		_selectedColor: '#FF0000',	//default color, if not using colorattribute.

        postCreate: function () {
		

        },
        update: function (obj, callback) {

            logger.debug(this.id + ".update");
			if (obj){
				this._contextObj = obj;			
            }
			
			this._resetSubscriptions();

            if (!google) {
                console.warn("Google JSAPI is not loaded, exiting!");
                callback();
                return;
            }

            if (!google.maps) {
                logger.debug(this.id + ".update load Google maps");
                var params = null;
				if (this.apiAccessKey !== "") {
					params = "key=" + this.apiAccessKey + "&libraries=drawing,places";
				} else {
					params = "libraries=drawing,places";
				}
                if (google.loader && google.loader.Secure === false) {
                    google.loader.Secure = true;
                }
                window._googleMapsLoading = true;
                google.load("maps", 3, {
                    other_params: params,
                    callback: lang.hitch(this, function () {
                        logger.debug(this.id + ".update load Google maps callback");
                        window._googleMapsLoading = false;
                        this._loadMap(callback);
                    })
                });
            } else {
                if (this._googleMap) {
                    logger.debug(this.id + ".update has _googleMap");
                    this._fetchObjects(callback);
                    google.maps.event.trigger(this._googleMap, "resize");
                } else {
                    logger.debug(this.id + ".update has no _googleMap");
                    if (window._googleMapsLoading) {
                        this._waitForGoogleLoad(callback);
                    } else {
                        this._loadMap(callback);
                    }
                }
            }
        },
        resize: function (box) {
            if (this._googleMap) {
                if (this._resizeTimer) {
                    clearTimeout(this._resizeTimer);
                }
                this._resizeTimer = setTimeout(lang.hitch(this, function () {
                    //logger.debug(this.id + ".resize");
                    google.maps.event.trigger(this._googleMap, "resize");
                    /*if (this.gotocontext) {
                        this._goToContext();
                    }*/
                }), 250);
            }
        },
       _waitForGoogleLoad: function (callback) {
            logger.debug(this.id + "._waitForGoogleLoad");
            var interval = null,
                i = 0,
                timeout = 5000; // We'll timeout if google maps is not loaded
            var intervalFunc = lang.hitch(this, function () {
                i++;
                if (i > timeout) {
                    logger.warn(this.id + "._waitForGoogleLoad: it seems Google Maps is not loaded in the other widget. Quitting");
                    this._executeCallback(callback);
                    clearInterval(interval);
                }
                if (!window._googleMapsLoading) {
                    this._loadMap(callback);
                    clearInterval(interval);
                }
            });
            interval = setInterval(intervalFunc, 1);
        },
        uninitialize: function () {
            window[this.id + "_mapsCallback"] = null;
        },
        _resetSubscriptions: function () {
            if (this._handle) {
                this.unsubscribe(this._handle);
                this._handle = null;
            }
           if (this._contextObj) {

                this._handle = this.subscribe({
                    guid: this._contextObj.getGuid(),
                    callback: lang.hitch(this, function (guid) {
						// 20170611 - if contextobject is actual mapEntity object, no need to retrieve from DB again, since we have it already as context
						if (this._contextObj && this.mapEntity === this._contextObj.getEntity()){
							this.parseObjects([ this._contextObj ]);
						} // 20181203 - if contextobject is not same as mapEntity object, retrieve all objects from DB again, since association could have changed. 
						else if (this._contextObj){
							this._objectCache = [];
							this._loadMap();
						} else {
							this._loadMap();
						}
                    })
                });
            }
        },
        _loadMap: function (callback) {
			
            domStyle.set(this.mapContainer, {
                height: this.mapHeight + 'px',
                width: this.mapWidth
            });

            this._defaultPosition = new google.maps.LatLng(this.defaultLat, this.defaultLng);

			var mapOptions = {
                zoom: 11,
                draggable: this.opt_drag,
                scrollwheel: this.opt_scroll,
                center: this._defaultPosition,
                mapTypeId: google.maps.MapTypeId[this.defaultMapType] || google.maps.MapTypeId.ROADMAP,
                mapTypeControl: this.opt_mapcontrol,
                mapTypeControlOption: {
                    style: google.maps.MapTypeControlStyle.HORIZONTAL_BAR
                },
                streetViewControl: this.opt_streetview,
                zoomControl: this.opt_zoomcontrol,
                tilt: parseInt(this.opt_tilt.replace("d", ""), 10)
            };
            if (this.styleArray !== ""){
                mapOptions.styles = JSON.parse(this.styleArray);
            }
			
			if (this.borderColor !== ""){
				this.domNode.style.border = "2px solid " + this.borderColor;
			}
			
			this._googleMap = new google.maps.Map(this.mapContainer, mapOptions);
			
			// if drawing is enabled form Modeler, check if contextobject is empty poly object without coordinates. If so-> Enable, if not Disable.
			if (this.enableDraw && (this._contextObj.getEntity() === this.mapEntity && this._contextObj.get(this.coordinatesAttr) == "")){
				
				var polyOptions = {
					strokeWeight: 0,
					fillOpacity: Number(this._contextObj.get(this.opacityAttr)),
					editable: true
				};
				var polyLineOptions = {
					strokeWeight: Number(Number(this._contextObj.get(this.lineStrokeWeightAttr))),
					fillOpacity: Number(this._contextObj.get(this.opacityAttr)),
					editable: true
				};

				this._drawingManager = new google.maps.drawing.DrawingManager({
					drawingMode: google.maps.drawing.OverlayType.POLYGON,
					drawingControl: true,
					drawingControlOptions: {
						position: google.maps.ControlPosition.TOP_CENTER,
						drawingModes: ['polyline','polygon']
					},
					polylineOptions: polyLineOptions,
					polygonOptions: polyOptions
				});
				
				this._drawingManager.setMap(this._googleMap);
				
				google.maps.event.addListener(this._drawingManager, 'overlaycomplete', lang.hitch(this, function (event){
					
					var polyObject,path,coordinates,coordinatesString,objectType;
					
					if (event.type != google.maps.drawing.OverlayType.MARKER) {
						this._drawingManager.setDrawingMode(null);
						
						polyObject = event.overlay;						
						path = polyObject.getPath();
						coordinates = path.getArray();
						coordinatesString = coordinates.toString();
						if (event.type == google.maps.drawing.OverlayType.POLYGON) 	{
							objectType = 'Polygon';
						} else if (event.type == google.maps.drawing.OverlayType.POLYLINE){
							objectType = 'Polyline';
						}
						
						this._setSelection(polyObject);	
						
						polyObject.setMap(null);
						
						var obj = {
							coordinatesArray : coordinatesString,
							color : 'red',
							objecttype : objectType,
							opacity: Number(this._contextObj.get(this.opacityAttr)),
							lineStrokeWeight: Number(this._contextObj.get(this.lineStrokeWeightAttr)),
						};
						
						// if contextobject is location object not having coordinates yet, it means a single edit mode, block drawing afterwards
						if (this._contextObj.getEntity() === this.mapEntity && this._contextObj.get(this.coordinatesAttr) == ""){
							// disable drawing, allowing only 1 object
							this._drawingManager.setOptions({
								drawingControl: false
							});
							
							this._contextObj.set(this.coordinatesAttr,coordinates);
							this._contextObj.set(this.objectTypeAttr,objectType);
							this._contextObj.set(this.colorAttr,'red');
							
							// set default color to red for new markers
							var color = this._contextObj.get(this.colorAttr);
							obj.color = color;						
							// update obj with guid, so dragging works later on
							obj.guid = this._contextObj.getGuid();
							obj.id = obj.guid;
							
						} else {
							mx.data.create({
								entity: this.mapEntity,
								callback: lang.hitch(this, function(mxObj) {

									mxObj.set(this.coordinatesAttr,coordinates);
									// set default color to red for new markers
									mxObj.set(this.colorAttr,'red');
									
									// update obj with guid, so dragging works later on
									obj.guid = mxObj.getGuid();
									obj.id = obj.guid;
									
									mx.data.commit({
										mxobj: mxObj,
										callback: lang.hitch(this,function() {
											
										}),
										error: lang.hitch(this, function(e) {
											console.error(this._logNode + "Could not commit object:", e);
										})
									});
																						
								}),
								error: function(e) {
									console.error(this._logNode + "Could not commit object:", e);
								}
							});
						}
					
						this._addGeoObject(obj);

					}
				}));
			}
			
			this._fetchObjects();
			
			this._executeCallback(callback);

        },
        _fetchObjects: function () {
           
			this._removeAllGeoObjects();
			
			this._objectsArr = [];
			
			if (this._contextObj && this.xpathConstraint.indexOf("[id='[%CurrentObject%]']") > -1){	
				this.parseObjects( [this._contextObj] );		
			} else {

				if (this._objectCache) {
					this._fetchFromCache();

				} else {
					this._fetchFromDB();

				}
                
            }

        },
        _refreshMap: function (objs) {

			this.mapBounds = new google.maps.LatLngBounds();
			
            var validCount = 0;
		
			// create objects
            dojoArray.forEach(objs, lang.hitch(this,function (obj) {
				
		if (obj.coordinatesArray && (obj.objecttype === 'Polygon' | obj.objecttype === 'Polyline')){
				this._addGeoObject(obj);
				validCount++;
			}
			
            }));
            
			if (validCount == 0) {
                this._googleMap.setZoom(this.lowestZoom);

            } 
			else if (validCount == 1){
				this._googleMap.fitBounds(this.mapBounds);
				if (this.overruleFitBoundsZoom){
					this._googleMap.setZoom(this.lowestZoom);
				}
			} else if (validCount > 1){
				this._googleMap.fitBounds(this.mapBounds);
			}
			
			if (this._progressID) {
				mx.ui.hideProgress(this._progressID);
				this._progressID = null;
            }
				
			// needed to set map again if geoobjects where still in cache. if they were in cache then map would be null.
			if (this._objectsArr.length > 1){
				for (var q = 0 ; q < this._objectsArr.length ; q++ ){
					this._objectsArr[q].setMap(this._googleMap);
				}
			}

        },
        _fetchFromDB: function () {
			if (this.consoleLogging){
				console.log('fetching from db');
			}

            var xpath = '//' + this.mapEntity + this.xpathConstraint;
			
			this._schema = [];
			this._refs = {};
			
			this.loadSchema(this.infoWindowAttr, 'infowindow');
			this.loadSchema(this.coordinatesAttr, 'coordinatesArray');
			this.loadSchema(this.colorAttr, 'color');
			this.loadSchema(this.holesAttr, 'holesArray');
			this.loadSchema(this.objectTypeAttr, 'objecttype');	
			this.loadSchema(this.lineTypeAttr, 'lineType');
			this.loadSchema(this.lineStrokeWeightAttr, 'lineStrokeWeight');
			this.loadSchema(this.opacityAttr, 'opacity');


			this.loadSchema(this.reverseCoordinatesAttr, 'reverseCoordinates');				
			
			// With empty _schema whole object is being pushed, this is a temporary fix
			if (this._schema.length == 0){
				this._schema.push('createdDate');
			}

            this._removeAllGeoObjects();

            if (this._contextObj) {
                xpath = xpath.replace('[%CurrentObject%]', this._contextObj.getGuid());
                mx.data.get({
                    xpath: xpath,
					filter      : {
						attributes  : this._schema,
						references	: this._refs
					},
                    callback: dojo.hitch(this, function(result){
						this.parseObjects(result);
					})
                });
            } else if (!this._contextObj && (xpath.indexOf('[%CurrentObject%]') > -1)) {
                if (this.consoleLogging){
					console.warn(this._logNode + 'No context for xpath, not fetching.');
				}
            } else {
                mx.data.get({
                    xpath: xpath,
					filter      : {
						attributes  : this._schema,
						references	: this._refs
					},
                    callback:  dojo.hitch(this, function(result){
						this.parseObjects(result);
					})
                });
            }
							
        },
		loadSchema : function (attr, name) {

			if (attr !== '') {
				this._splits[name] = attr.split("/");
				if (this._splits[name].length > 1)
					if (this._refs[this._splits[name][0]] && this._refs[this._splits[name][0]].attributes){
						this._refs[this._splits[name][0]].attributes.push(this._splits[name][2]);
					}
					else {
						this._refs[this._splits[name][0]] = {attributes : [this._splits[name][2]]};
					}
				else {
					this._schema.push(attr);
				}
			}
		}, 
		parseObjects : function (objs) {

			this._objects = objs;
			var newObjs = [];
			for (var i = 0; i < objs.length; i++) {
				var newObj = {};
				var entity = objs[i].getEntity();	
				var entityString = entity.substr(entity.indexOf('.')+1);		
				newObj.type = entityString;								
				newObj.infowindow = this.checkRef(objs[i], 'infowindow', this.infoWindowAttr);
				newObj.coordinatesArray = this.checkRef(objs[i], 'coordinatesArray', this.coordinatesAttr);
				newObj.color = this.checkRef(objs[i], 'color', this.colorAttr);
				newObj.holesArray = this.checkRef(objs[i], 'holesArray', this.holesAttr);	
				newObj.objecttype = this.checkRef(objs[i], 'objecttype', this.objectTypeAttr);
				newObj.reverseCoordinates = this.checkRef(objs[i], 'reverseCoordinates', this.reverseCoordinatesAttr);	
				newObj.lineType = this.checkRef(objs[i], 'lineType', this.lineTypeAttr);
				newObj.lineStrokeWeight = this.checkRef(objs[i], 'lineStrokeWeight', this.lineStrokeWeightAttr);	
				newObj.opacity = Number(this.checkRef(objs[i], 'opacity', this.opacityAttr));		
				newObj.guid = objs[i].getGuid();						
				newObjs.push(newObj);
			}	
			if (this.consoleLogging){
					console.log(this._logNode + 'the MendixObjects retrieved:');
					console.dir(objs);
					console.log(this._logNode + 'the objects used for displaying on the map:');
					console.dir(newObjs);
			}
			
			// after creating the objects, trigger a refreshMap. This will also add the markers based on the newObjs	
			this._refreshMap(newObjs);

		},	
		checkRef : function (obj, attr, nonRefAttr) {
			if (this._splits && this._splits[attr] && this._splits[attr].length > 1) {
				var subObj = obj.getChildren(this._splits[attr][0]);
				return (subObj.length > 0)?subObj[0].get(this._splits[attr][2]):'';
			} else {
				return obj.get(nonRefAttr);
			}
		},		
        _fetchFromCache: function () {

			if (this.consoleLogging){
				console.log('fetching from cache');
			}
            var self = this,
                cached = false,
                bounds = new google.maps.LatLngBounds();
				
            dojoArray.forEach(this._objectCache, function (geoObject, index) {
                if (self._contextObj) {
				
                    if (geoObject.id === self._contextObj.getGuid()) {
                        geoObject.setMap(self._googleMap);
                        bounds.extend(geoObject.position);
                        cached = true;
                    }
                } else {
                    geoObject.setMap(self._googleMap);
                }
                if (index === self._objectCache.length - 1) {
					self._googleMap.fitBounds(bounds);
					if (self.overruleFitBoundsZoom){
						self._googleMap.setZoom(self.lowestZoom);
					}
					self._googleMap.setZoom(self.lowestZoom);
                }
            });
			


            if (!cached) {

                this._fetchFromDB();
            }

        },
        _removeAllGeoObjects: function () {
			
            if (this._objectCache) {
                dojoArray.forEach(this._objectCache, function (object) {
					
                    object.setMap(null);
                });
            }
			
        },
        _addGeoObject: function (obj) {
			
			// if square brackets used, switch to normal brackets
			var coordinatesString = obj.coordinatesArray.replace(/\[/g,"(").replace(/\]/g,")").replace(/ /g,"");
 	
			// split string into array of coordinates
			var coordinates  = coordinatesString.split("),(");
			
			// create Google path from array of coordinates
			var path =  this._
			
			tPolyArray(coordinates,obj.reverseCoordinates,true);
			
			// get center of current Google path
			var centerLatLng = this.mapBoundsCurrent.getCenter();
			var geoObject = null;
			
            var id = this._contextObj ? this._contextObj.getGuid() : null;
			
			var opts = {			  
				path: path,
				geodesic: true,
				fillColor: obj.color,
				fillOpacity: Number(obj.opacity),
				strokeColor: obj.color,
				strokeOpacity: 3 * Number(obj.opacity),
				strokeWeight: Number(obj.lineStrokeWeight),
				center : centerLatLng
			}

			if (obj.objecttype === 'Polyline'){
				// set the stying options correcltly for a dotted / dashed line
				this._setLineStyleOptions(obj.lineType, opts);
				geoObject = new google.maps.Polyline(opts);
			} else if (obj.objecttype === 'Polygon'){
				geoObject = new google.maps.Polygon(opts);			
			} else {
				console.error(this._logNode + "An object needs an objecttype! Please check the widget settings in the Modeler!");
			}
            if (id) {
                geoObject.id = id;
            }
			
			if (!this.disableInfoWindow){
				google.maps.event.addListener(geoObject, "click", dojo.hitch(this, function() {
					
					if (this.enableDraw){
						this._setSelection(geoObject);
					}
					if (this._infowindow){
						this._infowindow.close();
					}	
					var infowindow = new google.maps.InfoWindow({
						content : 	this.infoWindowNameLabel + ': <b>' +  obj.infowindow,
						position : geoObject.center
					});
					
					infowindow.open(this._googleMap, geoObject);
					
					this._infowindow = infowindow;
					
					if (this.onclickmf){
						var objGuid = obj.guid;
						
						var guidBtnOptions = {
							"class" : "glyphicon glyphicon-share-alt",
							"type" : "button",
							"id" : objGuid,
							"style" : "cursor : pointer"
						};
						
						var guidBtn = dom.create("button", guidBtnOptions);
						
						google.maps.event.addListener(infowindow, 'domready', dojo.hitch(this,function() { // infowindow object is loaded into DOM async via Google, hence need to target the domready event

							infowindow.setContent(this.infoWindowNameLabel + ': <b>' +  obj.infowindow + '<br><br>' + guidBtn.outerHTML);
							var btn = document.getElementById(guidBtn.id);

							on(btn,'click', dojo.hitch(this, function(e) {
								this._execMf(this.onclickmf, objGuid);
							}));

						}));				
					}
				}));
			} else if (this.onclickmf && !this.enableDraw) {
                geoObject.addListener("click", lang.hitch(this, function () {
                    this._execMf(this.onclickmf, obj.guid);
                }));
            }	

			//Add a dynamic listener to the polygon or polygon click event for the NewEdit screen
			if (this._objectsArr.length <= 1 && this.enableDraw){
					google.maps.event.addListener(geoObject, 'mouseup', lang.hitch(this, function (){
					
					var MxObj = this._contextObj;
					var path = geoObject.getPath();

					google.maps.event.addListener(path, 'set_at', lang.hitch(this, function (event){
						// Here do the snapping, after the polygon has been resized
						var newcoordinates = path.getArray();

						var oldcoordinates = MxObj.coordinatesAttr;
						if (newcoordinates.toString() != oldcoordinates){
							for (var r = 0; r < newcoordinates.length; r++) {
								this.mapBounds.extend(newcoordinates[r]);
							}
	
							MxObj.set(this.coordinatesAttr, newcoordinates.toString());
							
						}
					}));

					google.maps.event.addListener(path, 'insert_at', dojo.hitch(this, function (event){
						// Here do the snapping, after the polygon has been resized
						var newcoordinates = path.getArray();
						var oldcoordinates = MxObj.coordinatesAttr;
						if (newcoordinates.toString() != oldcoordinates){
							for (var r = 0; r < newcoordinates.length; r++) {
								this.mapBounds.extend(newcoordinates[r]);
							}
							MxObj.set(this.coordinatesAttr, newcoordinates.toString());

						}
					}));

				}));
			}

			if (this.hoverColorPercentage != 0){
				var hoverColor = this.shadeColor2(obj.color,this.hoverColorPercentage);
				
				google.maps.event.addListener(geoObject,"mouseover",function(){
					this.setOptions({fillColor: hoverColor});
				});

				google.maps.event.addListener(geoObject,"mouseout",function(){
				 this.setOptions({fillColor: obj.color});
				});			
			}
			this._objectsArr.push(geoObject);
			
            if (!this._objectCache) {
                this._objectCache = [];
            }
			// filter operation gives back a list, but since only one marker should with same guid should be in the markercache, we can take the first
			var oldGeoObject = this._objectCache.filter(lang.hitch(this,function(e) {
				return e.id === geoObject.id;
			}))[0];
			
			var index = this._objectCache.indexOf(oldGeoObject);

			if (index > -1){
				// existing marker, so delete old instance and remove from map
				this._objectCache.splice(index, 1);
				oldGeoObject.setMap(null);
			}  
				
			geoObject.setMap(this._googleMap);
			this._objectCache.push(geoObject);
				
		},
		_setLineStyleOptions: function (lineType, styleOptions) {
			var icon,
				lineSymbol;
			if (lineType === "Dotted") {

				lineSymbol = {
					path: google.maps.SymbolPath.CIRCLE,
					fillOpacity: 1,
					scale: 3,
					strokeWeight: styleOptions.strokeWeight
				};
				styleOptions.strokeOpacity = 0;

			} else if (lineType === "Dashed") {
				lineSymbol = {
					path: 'M 0,-1 0,1',
					strokeOpacity: 1,
					scale: 4,
					strokeWeight: styleOptions.strokeWeight
				};
				styleOptions.strokeOpacity = 0;
			}
			var icons = [{
				icon: lineSymbol,
				offset: '0',
				repeat: '20px'
			}];
			styleOptions.icons = icons;

			return styleOptions;
		},
		shadeColor2 : function(color, percent) {
			var f=parseInt(color.slice(1),16),t=percent<0?0:255,p=percent<0?percent*-1:percent,R=f>>16,G=f>>8&0x00FF,B=f&0x0000FF;
			return "#"+(0x1000000+(Math.round((t-R)*p)+R)*0x10000+(Math.round((t-G)*p)+G)*0x100+(Math.round((t-B)*p)+B)).toString(16).slice(1);
		},
        _getLatLng: function (obj) {
            var lat = obj.lat,
                lng = obj.lng;

            if (lat === "" && lng === "") {
                return this._defaultPosition;
            } else if (!isNaN(lat) && !isNaN(lng) && lat !== "" && lng !== "") {
                return new google.maps.LatLng(lat, lng);
            } else {
                return null;
            }
        }, 
        _execMf: function (mf, guid, cb) {
			if (this.consoleLogging){
				console.log(this._logNode + "_execMf");
			}
            if (mf && guid) {
                mx.data.action({
                    params: {
                        applyto: "selection",
                        actionname: mf,
                        guids: [guid]
                    },
                    store: {
                        caller: this.mxform
                    },
                    callback: lang.hitch(this, function (obj) {
                        if (cb && typeof cb === "function") {
                            cb(obj);
                        }
                    }),
                    error: lang.hitch(this,function (error) {
                        console.debug(this._logNode + error.description);
                    })
                }, this);
            }
        },
		_constructPolyArray : function (coordinates,reversed,extendbound) {
			// reset mapbounds for current object. later on needed to get center to position infowindow correctly
			this.mapBoundsCurrent = new google.maps.LatLngBounds();
			
			var lat = [];
			var lng = [];
			var coordinate;
			var polyArray = [];
			var coordinatesNo = coordinates.length;

			coordinates[0] = coordinates[0].replace("(","");
			
			coordinates[coordinatesNo - 1] = coordinates[coordinatesNo -1].replace(")","");
			for (coordinate in coordinates) {
				coordinates[coordinate] = coordinates[coordinate].replace("(","");		// remove first (
				coordinates[coordinate] = coordinates[coordinate].replace(")","");		// remove last )
				if (reversed) {
					lng[coordinate] = coordinates[coordinate].split(",")[0];
					lat[coordinate] = coordinates[coordinate].split(",")[1];
				} else {
					lat[coordinate] = coordinates[coordinate].split(",")[0];
					lng[coordinate] = coordinates[coordinate].split(",")[1];

				}
				if (this.consoleLogging){
					console.log(parseFloat(lat[coordinate]) + " " + parseFloat(lng[coordinate]) + " (types: " + (typeof parseFloat(lat[coordinate])) + ", " + (typeof parseFloat(lng[coordinate])) + ")");
				}
				polyArray[coordinate] = new google.maps.LatLng(parseFloat(lat[coordinate]), parseFloat(lng[coordinate]));
				if (extendbound) {														// only change the bounds of the map for main objects, not for holes
					this.mapBounds.extend(polyArray[coordinate]);
					this.mapBoundsCurrent.extend(polyArray[coordinate]);
				}
			}
			return polyArray;
		},
		_clearSelection : function() {
			if (this._selectedShape) {
			  this._selectedShape.setEditable(false);
			  this._selectedShape = null;
			}
		 },
		_setSelection : function(shape) {

			this._clearSelection();
			this._selectedShape = shape;
			shape.setEditable(true);
			//this.selectColor(shape.get('fillColor') || shape.get('strokeColor'));
		},
		_executeCallback: function (cb) {
            if (cb && typeof cb === "function") {
                cb();
            }
        }
    });
});

require(["GoogleMapsPolygon/widget/GoogleMapsPolygon"], function() {});
