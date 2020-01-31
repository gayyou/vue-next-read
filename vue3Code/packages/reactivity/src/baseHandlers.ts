import { reactive, readonly, toRaw } from './reactive'
import { TrackOpTypes, TriggerOpTypes } from './operations'
import { track, trigger, ITERATE_KEY } from './effect'
import { LOCKED } from './lock'
import { isObject, hasOwn, isSymbol, hasChanged, isArray } from '@vue/shared'
import { isRef } from './ref'

const builtInSymbols = new Set(
  Object.getOwnPropertyNames(Symbol)
    .map(key => (Symbol as any)[key])
    .filter(isSymbol)
)

const get = /*#__PURE__*/ createGetter()
const readonlyGet = /*#__PURE__*/ createGetter(true)
const shallowReadonlyGet = /*#__PURE__*/ createGetter(true, true)

// 这里是提供includes、indexOf、lastIndexOf方法，相对于容器类的迭代而言的方法。
//  TODO 为什么不把数组的其它方法如：slice、sort、splice等都加到这个数组中呢？
const arrayIdentityInstrumentations: Record<string, Function> = {}
;['includes', 'indexOf', 'lastIndexOf'].forEach(key => {
  arrayIdentityInstrumentations[key] = function(
    value: unknown,
    ...args: any[]
  ): any {
    // this: 指向上下文对象，这里只是提供一个方法而已
    return toRaw(this)[key](toRaw(value), ...args)
  }
})

/**
 * @description 该方法返回的是代理的get方法，
 * @param isReadonly 是否是只读
 * @param shallow    是否是浅观察
 */
function createGetter(isReadonly = false, shallow = false) {
  return function get(target: object, key: string | symbol, receiver: object) {
    if (isArray(target) && hasOwn(arrayIdentityInstrumentations, key)) {
      return Reflect.get(arrayIdentityInstrumentations, key, receiver)
    }
    // 通过反射方法得到这个对象原始的值
    const res = Reflect.get(target, key, receiver)
    if (isSymbol(key) && builtInSymbols.has(key)) {
      return res
    }
    if (shallow) {
      // 只进行浅观察
      track(target, TrackOpTypes.GET, key)
      // TODO strict mode that returns a shallow-readonly version of the value
      return res
    }
    if (isRef(res)) {
      return res.value
    }

    track(target, TrackOpTypes.GET, key)

    // 这里就对这个对象进行深度遍历观察
    return isObject(res)
      ? isReadonly
        ? // need to lazy access readonly and reactive here to avoid
          // circular dependency
          readonly(res)
        : reactive(res)
      : res
  }
}

const set = /*#__PURE__*/ createSetter()
const readonlySet = /*#__PURE__*/ createSetter(true)
const shallowReadonlySet = /*#__PURE__*/ createSetter(true, true)

function createSetter(isReadonly = false, shallow = false) {
  return function set(
    target: object,
    key: string | symbol,
    value: unknown,       // 新值，可能是一个观察者的代理对象，也可能是一个普通的对象
    receiver: object
  ): boolean {
    /**
     * @param target 被代理的对象
     * @param receiver 代理对象
     */
    if (isReadonly && LOCKED) {
      if (__DEV__) {
        console.warn(
          `Set operation on key "${String(key)}" failed: target is readonly.`,
          target
        )
      }
      return true
    }

    const oldValue = (target as any)[key];  // 拿到之前的值
    if (!shallow) {
      // 如果是一个代理对象，那么就拿到这个代理对象的普通对象，如果不是的话，拿到原本的对象
      value = toRaw(value)
      // 如果旧的值是一个ref的值而新的值却不是一个ref的值，那么将ref的值直接进行修改
      if (isRef(oldValue) && !isRef(value)) {
        oldValue.value = value
        return true
      }
    } else {
      // in shallow mode, objects are set as-is regardless of reactive or not
    }

    const hadKey = hasOwn(target, key)
    const result = Reflect.set(target, key, value, receiver)   // 通过反射方法才能对这个值进行设置
    // don't trigger if target is something up in the prototype chain of original
    // 如果目标是原始原型链中的某个对象，请勿触发
    if (target === toRaw(receiver)) {
      // target其实是receiver的原生对象，如果两者不相等的话，是不会进行执行下面代码的
      // 判断target是否是receiver的被代理对象。
      // TODO 在proxy中，receiver和target代理对象与被代理对象，但是它们之间的关系只有在这里被体现出来。
      //  在其他地方是没有体现这一关系的，我们使用WeakMap来将代理对象与被代理对象联系起来。
      //  只有在添加到双方关系的WeakSet中才能被触发依赖
      /* istanbul ignore else */
      if (__DEV__) {
        const extraInfo = { oldValue, newValue: value }
        if (!hadKey) {
          trigger(target, TriggerOpTypes.ADD, key, extraInfo)
        } else if (hasChanged(value, oldValue)) {
          trigger(target, TriggerOpTypes.SET, key, extraInfo)
        }
      } else {
        if (!hadKey) {
          // trigger就是触发观察者回调函数
          trigger(target, TriggerOpTypes.ADD, key)
        } else if (hasChanged(value, oldValue)) {
          trigger(target, TriggerOpTypes.SET, key)
        }
      }
    }
    return result
  }
}

function deleteProperty(target: object, key: string | symbol): boolean {
  const hadKey = hasOwn(target, key)
  const oldValue = (target as any)[key]
  const result = Reflect.deleteProperty(target, key)
  if (result && hadKey) {
    /* istanbul ignore else */
    if (__DEV__) {
      trigger(target, TriggerOpTypes.DELETE, key, { oldValue })
    } else {
      trigger(target, TriggerOpTypes.DELETE, key)
    }
  }
  return result
}

function has(target: object, key: string | symbol): boolean {
  const result = Reflect.has(target, key)
  track(target, TrackOpTypes.HAS, key)
  return result
}

function ownKeys(target: object): (string | number | symbol)[] {
  track(target, TrackOpTypes.ITERATE, ITERATE_KEY)
  return Reflect.ownKeys(target)
}

export const mutableHandlers: ProxyHandler<object> = {
  get,
  set,
  deleteProperty,
  has,
  ownKeys
}

export const readonlyHandlers: ProxyHandler<object> = {
  get: readonlyGet,
  set: readonlySet,
  has,
  ownKeys,
  deleteProperty(target: object, key: string | symbol): boolean {
    if (LOCKED) {
      if (__DEV__) {
        console.warn(
          `Delete operation on key "${String(
            key
          )}" failed: target is readonly.`,
          target
        )
      }
      return true
    } else {
      return deleteProperty(target, key)
    }
  }
}

// props handlers are special in the sense that it should not unwrap top-level
// refs (in order to allow refs to be explicitly passed down), but should
// retain the reactivity of the normal readonly object.
export const shallowReadonlyHandlers: ProxyHandler<object> = {
  ...readonlyHandlers,
  get: shallowReadonlyGet,
  set: shallowReadonlySet
}
