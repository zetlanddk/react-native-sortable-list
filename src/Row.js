import React, {Component, cloneElement} from 'react';
import PropTypes from 'prop-types';
import {Animated, PanResponder, StyleSheet, ViewPropTypes, View, Text, TouchableHighlight} from 'react-native';
import {shallowEqual} from './utils';

export default class Row extends Component {
  static propTypes = {
    children: PropTypes.node,
    animated: PropTypes.bool,
    disabled: PropTypes.bool,
    horizontal: PropTypes.bool,
    style: ViewPropTypes.style,
    location: PropTypes.shape({
      x: PropTypes.number,
      y: PropTypes.number,
    }),
    manuallyActivateRows: PropTypes.bool,
    activationTime: PropTypes.number,

    swipeRightAction: PropTypes.object,
    swipeLeftAction: PropTypes.object,

    // Will be called on long press.
    onActivate: PropTypes.func,
    onLayout: PropTypes.func,
    onPress: PropTypes.func,

    // Will be called, when user (directly) move the view.
    onMove: PropTypes.func,

    // Will be called, when user release the view.
    onRelease: PropTypes.func,
  };

  static defaultProps = {
    location: {x: 0, y: 0},
    activationTime: 200,
  };

  constructor(props) {
    super(props);

    this._animatedLocation = new Animated.ValueXY(props.location);
    this._location = props.location;

    this._animatedLocation.addListener(this._onChangeLocation);

    this.state = {
      swipeX: new Animated.Value(0),
    };
  }

  _panResponder = PanResponder.create({
    onStartShouldSetPanResponder: () => !this._isDisabled(),

    onMoveShouldSetPanResponder: (e, gestureState) => {
      if (this._isDisabled()) return false;

      const vy = Math.abs(gestureState.vy)
      const vx = Math.abs(gestureState.vx)

      return this.swiping || (this._active && (this.props.horizontal ? vx > vy : vy > vx));;
    },

    onShouldBlockNativeResponder: () => {
      // Returns whether this component should block native components from becoming the JS
      // responder. Returns true by default. Is currently only supported on android.
      // NOTE: Returning false here allows us to scroll unless it's a long press on a row.
      return false;
    },

    onPanResponderGrant: (e, gestureState) => {
      e.persist();

      this._target = e.nativeEvent.target;
      this._prevGestureState = {
        ...gestureState,
        moveX: gestureState.x0,
        moveY: gestureState.y0,
      };

      if (this.props.manuallyActivateRows) return;

      this._longPressTimer = setTimeout(() => {
        if (this._active || this.swiping) return;

        this._toggleActive(e, gestureState);
      }, this.props.activationTime);
    },

    onPanResponderMove: (e, gestureState) => {

      const vy = Math.abs(gestureState.vy)
      const vx = Math.abs(gestureState.vx)
      if (!this._active) {
        const swiping = vx > vy;
        if (!this.swiping && swiping) {
          this.props.onActivate();
        }
        this.swiping = this.swiping || swiping;
      }
      if (this.swiping) {
        this.props.onActivate();
        this.handleSwipeGesture(gestureState);
        return;
      }

      if (
        (!this._active ||
        gestureState.numberActiveTouches > 1 ||
        e.nativeEvent.target !== this._target)
      ) {
        if (!this._isTouchInsideElement(e) || this.swiping) {
          this._cancelLongPress();
        }

        return;
      }

      const elementMove = this._mapGestureToMove(this._prevGestureState, gestureState);
      this.moveBy(elementMove);
      this._prevGestureState = {...gestureState};

      if (this.props.onMove) {
        this.props.onMove(e, gestureState, this._nextLocation);
      }
    },

    onPanResponderRelease: (e, gestureState) => {
      if (this.swiping) {
        this.handleSwipeEnd(gestureState);
        return;
      }

      if (this._active) {
        this._toggleActive(e, gestureState);

      } else {
        this._cancelLongPress();

        if (this._isTouchInsideElement(e) && this.props.onPress) {
          this.props.onPress();
        }
      }
    },

    onPanResponderTerminationRequest: (e, gestureState) => {
      if (this._active) {
        // If a view is active do not release responder.
        return false;
      }

      this._cancelLongPress();

      return true;
    },

    onPanResponderTerminate: (e, gestureState) => {
      this._cancelLongPress();

      // If responder terminated while dragging,
      // deactivate the element and move to the initial location.
      if (this._active) {
        this._toggleActive(e, gestureState);

        if (shallowEqual(this.props.location, this._location)) {
          this._relocate(this.props.location);
        }
      }
    },
  });

  handleSwipeGesture = (gestureState) => {
    const { swipeLeftAction, swipeRightAction } = this.props;
    const { dx, vx } = gestureState;
    let toValue = 0;
    if (swipeLeftAction && dx > 0) toValue = dx;
    if (swipeRightAction && dx < 0) toValue = dx;
    Animated.timing(this.state.swipeX, {
      toValue: toValue,
      duration: 0,
    }).start();
    this.swipeVelocity = vx;
    this.lastSwipeX = toValue;
    this.swiping = true;
  };

  handleSwipeEnd = (gestureState) => {
    if (this.lastSwipeX < -100) {
      Animated.timing(this.state.swipeX, {
        toValue: -100,
        duration: 500,
        nativeEvent: true,
      }).start();
    } else if (this.lastSwipeX > 100) {
      Animated.timing(this.state.swipeX, {
        toValue: 100,
        duration: 500,
        nativeEvent: true,
      }).start();
    } else {
      Animated.timing(this.state.swipeX, {
        toValue: 0,
        duration: 500,
        nativeEvent: true,
      }).start();
    }
    this.swiping = false;
    this.props.onRelease();
  };

  resetSwipe = () => {
    Animated.timing(this.state.swipeX, {
      toValue: 0,
      duration: 500,
      nativeEvent: true,
    }).start();
  }

  componentWillReceiveProps(nextProps) {
    if (!this._active && !shallowEqual(this._location, nextProps.location)) {
      const animated = !this._active && nextProps.animated;
      this._relocate(nextProps.location, animated);
    }
  }

  shouldComponentUpdate(nextProps, nextState) {
    return this.props.disabled !== nextProps.disabled ||
           this.props.children !== nextProps.children ||
           !shallowEqual(this.props.style, nextProps.style);
  }

  moveBy({dx = 0, dy = 0, animated = false}) {
    this._nextLocation = {
      x: this._location.x + dx,
      y: this._location.y + dy,
    };
    this._relocate(this._nextLocation, animated);
  }

  render() {
    const {children, style, horizontal, swipeLeftAction, swipeRightAction, data} = this.props;
    const rowStyle = [
      style, styles.container, this._animatedLocation.getLayout(),
      horizontal ? styles.horizontalContainer : styles.verticalContainer,
    ];

    return (
      <Animated.View
        {...this._panResponder.panHandlers}
        style={rowStyle}
        onLayout={this._onLayout}>
          <View style={styles.swipeContainer}>
            { swipeLeftAction ? (
              <TouchableHighlight
                underlayColor="transparent"
                onPress={() => swipeLeftAction.onTap(data)}
                style={styles.swipeLeft}>
                { swipeLeftAction.render() }
              </TouchableHighlight>
            ) : <View /> }
            { swipeRightAction ? (
              <TouchableHighlight
                underlayColor="transparent"
                onPress={() => swipeRightAction.onTap(data)}
                style={styles.swipeRight}>
                { swipeRightAction.render() }
              </TouchableHighlight>
            ) : <View /> }
          </View>
          <Animated.View style={{transform: [{translateX: this.state.swipeX}]}}>
            {this.props.manuallyActivateRows && children
              ? cloneElement(children, {
                toggleRowActive: this._toggleActive,
              })
              : children
            }
          </Animated.View>
      </Animated.View>
    );
  }

  _cancelLongPress() {
    clearTimeout(this._longPressTimer);
  }

  _relocate(nextLocation, animated) {
    this._location = nextLocation;

    if (animated) {
      this._isAnimationRunning = true;
      Animated.timing(this._animatedLocation, {
        toValue: nextLocation,
        duration: 300,
      }).start(() => {
        this._isAnimationRunning = false;
      });
    } else {
      this._animatedLocation.setValue(nextLocation);
    }
  }

  _toggleActive = (e, gestureState) => {
    const callback = this._active ? this.props.onRelease : this.props.onActivate;

    this._active = !this._active;

    if(this._active) {
      this.resetSwipe();
    }

    if (callback) {
      callback(e, gestureState, this._location);
    }
  };

  _mapGestureToMove(prevGestureState, gestureState, swipe) {
    return this.props.horizontal || swipe
      ? {dx: gestureState.moveX - prevGestureState.moveX}
      : {dy: gestureState.moveY - prevGestureState.moveY};
  }

  _isDisabled() {
      return this.props.disabled ||
        this._isAnimationRunning;
    }

  _isTouchInsideElement({nativeEvent}) {
    return this._layout &&
      nativeEvent.locationX >= 0 &&
      nativeEvent.locationX <= this._layout.width &&
      nativeEvent.locationY >= 0 &&
      nativeEvent.locationY <= this._layout.height;
  }

  _onChangeLocation = (value) => {
    this._location = value;
  };

  _onLayout = (e) => {
      this._layout = e.nativeEvent.layout;
      if (this.props.onLayout) {
          this.props.onLayout(e);
      }
  };
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
  },
  swipeContainer: {
    position: 'absolute',
    height: '100%',
    width: '100%',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  swipeRight: {
    height: '100%',
    width: '50%',
    backgroundColor: 'rgba(255,255,255,0.3)',
    alignItems: 'flex-end',
    justifyContent: 'center',
  },
  swipeLeft: {
    height: '100%',
    width: '50%',
    backgroundColor: 'rgba(255,255,255,0.3)',
    alignItems: 'flex-start',
    justifyContent: 'center',
  },
  horizontalContainer: {
    top: 0,
    bottom: 0,
  },
  verticalContainer: {
    left: 0,
    right: 0,
  },
});
