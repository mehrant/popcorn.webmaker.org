/* This Source Code Form is subject to the terms of the MIT license
 * If a copy of the MIT license was not distributed with this file, you can
 * obtain one at https://raw.github.com/mozilla/butter/master/LICENSE */

/**
 * Module: TrackEvent
 *
 * Supports a single event in the Media > Track > TrackEvent model.
 */
define( [ "./logger", "./eventmanager", "./observer",
          "util/lang", "util/time", "./views/trackevent-view", "localized" ],
  function( Logger, EventManager, Observer,
            LangUtil, TimeUtil, TrackEventView, Localized ) {

  var __guid = 0;

  var __trackEventExceptionStrings = {
    "trackevent-overlap": "The times you have entered cause trackevents to overlap.",
    "invalid-start-time": "[start] is an invalid value.",
    "invalid-end-time": "[end] is an invalid value.",
    "start-greater-than-end": "[start] must be less than [end]."
  };

  var TrackEventUpdateException = function ( reason ) {
    this.type = "trackevent-update";
    this.reason = reason;
    this.message = __trackEventExceptionStrings[ reason ];
    this.toString = function () {
      return "TrackEvent update failed: " + this.message;
    };
  };

  /**
   * Class: TrackEvent
   *
   * Represents and governs a single popcorn event.
   *
   * @param {Object} options: Options for initialization. Can contain the properties type, name, and popcornOptions. If the popcornOptions property is specified, its contents will be used to initialize the plugin instance associated with this TrackEvent.
   */
  var TrackEvent = function ( options ) {

    options = options || {};

    var _this = this,
        _id = "TrackEvent" + __guid++,
        _name = options.name || _id,
        _logger = new Logger( _id ),
        _track = null,
        _type = options.type + "",
        _popcornOptions = options.popcornOptions || {
          start: 0,
          end: 1
        },
        _view = new TrackEventView( this, _type, _popcornOptions ),
        _popcornWrapper = null,
        _defaults = options.defaults || {},
        _isDefault = false,
        _selected = false;

    _this.defaults = _defaults;

    EventManager.extend( _this );
    Observer.extend( _this );

    _this.popcornOptions = _popcornOptions;
    _this.popcornTrackEvent = null;

    function defaultValue( prop, manifest ) {

      var item = manifest[ prop ];

      if ( _defaults.current &&
           _defaults.current.popcornOptions[ prop ] ) {
        return _defaults.current.popcornOptions[ prop ];
      } else if ( item.hasOwnProperty( "default" ) ) {
        return item.default;
      }
      return item.type === "number" ? 0 : "";
    }

    if ( !_type ){
      _logger.log( "Warning: " + _id + " has no type." );
    }
    else {
      this.manifest = Popcorn.manifest[ _type ];
    }

    _popcornOptions.start = _popcornOptions.start || 0;
    _popcornOptions.start = TimeUtil.roundTime( _popcornOptions.start );
    _popcornOptions.end = _popcornOptions.end || _popcornOptions.start + 1;
    _popcornOptions.end = TimeUtil.roundTime( _popcornOptions.end );


    /**
     * Member: bind
     *
     * Binds the TrackEvent to its dependencies.
     *
     * @param {Object} track: The track the trackevent will inhabit.
     * @param {Object} popcornWrapper: a reference to a PopcornWrapper object that wraps various functionality for modifying Popcorn data.
     */
    this.bind = function( track, popcornWrapper ) {
      _track = track;
      _popcornWrapper = popcornWrapper;
    };

    /**
     * Member: applyDefaults
     *
     * Creates a diff of updatable options and applies them to update.
     */
    this.applyDefaults = function() {
      var newOptions = {},
          manifestOptions = {},
          popcornOptions = this.popcornOptions,
          foundMissingOptions = false,
          value;
      if ( !this.manifest ) {
        return;
      }
      manifestOptions = this.manifest.options;
      for ( var prop in manifestOptions ) {
        if ( manifestOptions.hasOwnProperty( prop ) ) {
          if ( !popcornOptions.hasOwnProperty( prop ) ) {
            foundMissingOptions = true;
            value = defaultValue( prop, manifestOptions );
            newOptions[ prop ] = Localized.get( value ) ? Localized.get( value ) : value;
          }
        }
      }

      newOptions = foundMissingOptions ? newOptions : null;
      this.update( newOptions );
    };

    /**
     * Member: update
     *
     * Updates the event properties and runs sanity checks on input.
     *
     * @param {Object} updateOptions: Object containing plugin-specific properties to be updated for this TrackEvent.
     * @event trackeventupdated: Occurs when an update operation succeeded.
     * @throws TrackEventUpdateException: When an update operation failed because of conflicting times or other serious property problems.
     */
    this.update = function( updateOptions ) {

      var newStart,
          newEnd,
          manifestOptions,
          media,
          preventUpdate = true,
          updateNotification,
          duration;

      if ( !updateOptions ) {
        updateOptions = {};
        preventUpdate = false;
      }

      newStart = updateOptions.start;
      newEnd = updateOptions.end;

      if ( isNaN( newStart ) ) {
        if ( updateOptions.hasOwnProperty( "start" ) ) {
          throw new TrackEventUpdateException( "invalid-start-time", "[start] is an invalid value." );
        }
        else {
          newStart = _popcornOptions.start;
        }
      }

      if ( isNaN( newEnd ) ) {
        if ( updateOptions.hasOwnProperty( "end" ) ) {
          throw new TrackEventUpdateException( "invalid-end-time", "[end] is an invalid value." );
        }
        else {
          newEnd = _popcornOptions.end;
        }
      }

      if ( newStart > newEnd ) {
        throw new TrackEventUpdateException( "start-greater-than-end", "[start] must be less than [end]." );
      }

      if ( newStart !== _popcornOptions.start || newEnd !== _popcornOptions.end ) {
        preventUpdate = false;
      }

      // Synchronously notify observers that an update is happening.
      // This action gives observers a chance to stop the trackevent from updating
      // if a problem is detected. If `notify` returns `false`, the update is cancelled
      // because some subscriber wished to prevent it from being committed.
      updateNotification = _this.notify( "update", updateOptions );
      if ( updateNotification.cancelled ) {
        return;
      }

      if ( _track && _track._media ) {
        media = _track._media;
        duration = media.duration;

        if ( this.manifest ) {
          manifestOptions = this.manifest.options;
          if ( manifestOptions ) {
            for ( var prop in manifestOptions ) {
              if ( manifestOptions.hasOwnProperty( prop ) &&
                   updateOptions.hasOwnProperty( prop ) ) {

                // If we find an instance were the two properties differ, it means we need to update.
                if ( _popcornOptions[ prop ] !== updateOptions[ prop ] ) {
                  preventUpdate = false;
                }
                _popcornOptions[ prop ] = updateOptions[ prop ];
              }
            }
            if ( !( "target" in manifestOptions ) && updateOptions.target ) {

              if ( _popcornOptions.target !== updateOptions.target ) {
                preventUpdate = false;
              }

              _popcornOptions.target = updateOptions.target;
            }
            if ( "zindex" in manifestOptions && media ) {
              var newZIndex = media.maxPluginZIndex - _track.order;

              if ( _popcornOptions.zindex !== newZIndex ) {
                preventUpdate = false;
              }

              _popcornOptions.zindex = updateOptions.zindex = newZIndex;
            }
          }
        }
      }

      _popcornOptions.start = newStart;
      _popcornOptions.end = newEnd;

      // if PopcornWrapper exists, it means we're connected properly to a Popcorn instance,
      // and can update the corresponding Popcorn trackevent for this object
      if ( _popcornWrapper && !preventUpdate ) {
        _popcornWrapper.synchronizeEvent( _this, updateOptions );
      }
    };

    /**
     * Member: unbind
     *
     * Kills references to popcornWrapper and track which are necessary to function. TrackEvent becomes
     * a husk for popcorn data at this point.
     */
    this.unbind = function( preventRemove ) {
      if ( !preventRemove && _popcornWrapper ) {
        _popcornWrapper.destroyEvent( _this );
        _popcornWrapper = null;
      }
      _track = null;
    };

    /**
     * Member: copy
     *
     * Returns a copy of the data needed to create a track event just like this one.
     * Does not copy state or unique data.
     */
    this.copy = function() {
      var popcornOptions = {},
          manifestOptions = {};
      if ( this.manifest ) {
        manifestOptions = _this.manifest.options;
        if ( manifestOptions ) {
          for ( var prop in manifestOptions ) {
            if ( manifestOptions.hasOwnProperty( prop ) ) {
              popcornOptions[ prop ] = _popcornOptions[ prop ];
            }
          }
        }
      }
      return {
        popcornOptions: popcornOptions,
        type: _type,
        track: _track
      };
    };

    Object.defineProperties( this, {

      /**
       * Property: track
       *
       * Specifies the track on which this TrackEvent currently sites.
       */
      track: {
        enumerable: true,
        get: function(){
          return _track;
        }
      },

      /**
       * Property: view
       *
       * A reference to the view object generated for this TrackEvent.
       * @malleable: No.
       */
      view: {
        enumerable: true,
        configurable: false,
        get: function(){
          return _view;
        }
      },
      /**
       * Property: dragging
       *
       * This TrackEvent's dragging state. True when TrackEvent is being dragged.
       * @malleable: No.
       */
      dragging: {
        enumerable: true,
        get: function(){
          return _view.dragging;
        }
      },

      /**
       * Property: resizing
       *
       * This TrackEvent's resizing state. True when TrackEvent is being resized.
       * @malleable: No.
       */
      resizing: {
        enumerable: true,
        get: function(){
          return _view.resizing;
        }
      },

      /**
       * Property: uiInUse
       *
       * This TrackEvent's resizing state. True when TrackEvent is being resized.
       * @malleable: No.
       */
      uiInUse: {
        enumerable: true,
        get: function(){
          return _view.resizing || _view.dragging;
        }
      },

      /**
       * Property: type
       *
       * The type representing the popcorn plugin created and manipulated by this TrackEvent.
       * @malleable: No.
       */
      type: {
        enumerable: true,
        get: function(){
          return _type;
        }
      },

      /**
       * Property: name
       *
       * Name of this TrackEvent.
       * @malleable: No.
       */
      name: {
        enumerable: true,
        get: function(){
          return _name;
        }
      },

      /**
       * Property: id
       *
       * Name of this TrackEvent.
       * @malleable: No.
       */
      id: {
        enumerable: true,
        get: function(){
          return _id;
        }
      },

      isDefault: {
        enumerable: true,
        get: function(){
          return _isDefault;
        },
        set: function( val ) {
          if ( val ) {
            _defaults.current = _this;
          } else {
            _defaults.current = null;
          }
          _isDefault = val;
        }
      },

      /**
       * Property: selected
       *
       * Specifies the state of selection. When true, this TrackEvent is selected.
       *
       * @malleable: Yes.
       * @event trackeventselected: Dispatched when selected state changes to true.
       * @event trackeventdeselected: Dispatched when selected state changes to false.
       */
      selected: {
        enumerable: true,
        get: function(){
          return _selected;
        },
        set: function( val ){
          _selected = val;
          _view.selected = _selected;
          if ( _selected ){
            _this.notify( "selected" );
            _this.dispatch( "trackeventselected" );
          }
          else {
            _this.notify( "deselected" );
            _this.dispatch( "trackeventdeselected" );
          } //if
        }
      },

      /**
       * Property: json
       *
       * Represents this TrackEvent in a portable JSON format.
       *
       * @malleable: Yes. Will import JSON in the same format that it was exported.
       * @event trackeventupdated: When this property is set, the TrackEvent's data will change, so a trackeventupdated event will be dispatched.
       */
      json: {
        enumerable: true,
        get: function(){
          return {
            id: _id,
            type: _type,
            popcornOptions: LangUtil.clone( _popcornOptions ),
            track: _track ? _track.id : undefined,
            name: _name
          };
        },
        set: function( importData ){
          _type = _popcornOptions.type = importData.type;
          this.manifest = Popcorn.manifest[ _type ];
          if ( importData.name ){
            _name = importData.name;
          }
          _popcornOptions = importData.popcornOptions;
          _this.popcornOptions = _popcornOptions;
          _view.type = _type;
          _view.update( _popcornOptions );
          _this.dispatch( "trackeventupdated", _this );
        }
      }
    }); //properties

  }; //TrackEvent

  TrackEvent.MINIMUM_TRACKEVENT_SIZE = 0.02;

  return TrackEvent;

}); //define
