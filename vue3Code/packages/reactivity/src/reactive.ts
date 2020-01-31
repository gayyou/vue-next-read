import { isObject, toRawType } from '@vue/shared'
import {
  mutableHandlers,
  readonlyHandlers,
  shallowReadonlyHandlers
} from './baseHandlers'
import {
  mutableCollectionHandlers,
  readonlyCollectionHandlers
} from './collectionHandlers'
import { UnwrapRef, Ref } from './ref'
import { makeMap } from '@vue/shared'

// WeakMaps that store {raw <-> observed} pairs.
const rawToReactive = new WeakMap<any, any>()   // 根据普通对象的hashCode拿到观察者对象（也就是代理后的）
const reactiveToRaw = new WeakMap<any, any>()   // 根据观察者对象拿到普通对象
const rawToReadonly = new WeakMap<any, any>()   // 根据普通对象拿到只读的对象
const readonlyToRaw = new WeakMap<any, any>()   // 根据只读对象的代理对象来拿到普通的对象

// WeakSets for values that are marked readonly or non-reactive during
// observable creation.
const readonlyValues = new WeakSet<any>()
const nonReactiveValues = new WeakSet<any>()      // 使用WeakSet的原因是尽量减少对对象的引用，从而允许GC进行

const collectionTypes = new Set<Function>([Set, Map, WeakMap, WeakSet])
const isObservableType = /*#__PURE__*/ makeMap(
  'Object,Array,Map,Set,WeakMap,WeakSet'
)

//
const canObserve = (value: any): boolean => {
  return (
    !value._isVue &&                        // 不是vue对象
    !value._isVNode &&                      // 不是VNode对象
    isObservableType(toRawType(value)) &&   // 需要被观察的类型
    !nonReactiveValues.has(value)           // 排除在外的观察属性
  )
}

// only unwrap nested ref
type UnwrapNestedRefs<T> = T extends Ref ? T : UnwrapRef<T>

export function reactive<T extends object>(target: T): UnwrapNestedRefs<T>
export function reactive(target: object) {
  // if trying to observe a readonly proxy, return the readonly version.
  // 如果尝试观察一个已经被已读观察者标记过的对象的时候，返回这个已经被观察的对象代理
  if (readonlyToRaw.has(target)) {
    return target
  }
  // target is explicitly marked as readonly by user
  // 目标被用户显式标记为只读，也就是还没有被观察，但是需要被弄成只读观察者
  if (readonlyValues.has(target)) {
    return readonly(target)
  }

  // 创建普通的观察者对象
  return createReactiveObject(
    target,
    rawToReactive,
    reactiveToRaw,
    mutableHandlers,
    mutableCollectionHandlers
  )
}

export function readonly<T extends object>(
  target: T
): Readonly<UnwrapNestedRefs<T>> {
  // value is a mutable observable, retrieve its original and return
  // a readonly version.
  if (reactiveToRaw.has(target)) {
    target = reactiveToRaw.get(target)
  }
  return createReactiveObject(
    target,
    rawToReadonly,
    readonlyToRaw,
    readonlyHandlers,
    readonlyCollectionHandlers
  )
}

// @internal
// Return a reactive-copy of the original object, where only the root level
// properties are readonly, and does not recursively convert returned properties.
// This is used for creating the props proxy object for stateful components.
export function shallowReadonly<T extends object>(
  target: T
): Readonly<{ [K in keyof T]: UnwrapNestedRefs<T[K]> }> {
  return createReactiveObject(
    target,
    rawToReadonly,
    readonlyToRaw,
    shallowReadonlyHandlers,
    readonlyCollectionHandlers
  )
}

/**
 *
 * @param target
 * @param toProxy
 * @param toRaw
 * @param baseHandlers
 * @param collectionHandlers
 */
function createReactiveObject(
  target: unknown,
  toProxy: WeakMap<any, any>,
  toRaw: WeakMap<any, any>,
  baseHandlers: ProxyHandler<any>,            // base就是对基本数据，如对象什么的数据类型进行依赖的添加
  collectionHandlers: ProxyHandler<any>       // collectionHandler就是对容器类型的对象进行依赖的添加
) {
  if (!isObject(target)) {
    if (__DEV__) {
      console.warn(`value cannot be made reactive: ${String(target)}`)
    }
    return target
  }
  // target already has corresponding Proxy
  let observed = toProxy.get(target)
  if (observed !== void 0) {
    return observed
  }
  // target is already a Proxy
  if (toRaw.has(target)) {
    return target
  }
  // only a whitelist of value types can be observed.
  if (!canObserve(target)) {
    return target
  }

  // TODO 如果目标是Set WeakSet Map WeakMap的话，就是用容器的代理handler，如果不是的话，就是用普通的代理handler
  const handlers = collectionTypes.has(target.constructor)
    ? collectionHandlers
    : baseHandlers
  observed = new Proxy(target, handlers)

  toProxy.set(target, observed)
  toRaw.set(observed, target)

  return observed
}

export function isReactive(value: unknown): boolean {
  return reactiveToRaw.has(value) || readonlyToRaw.has(value)
}

export function isReadonly(value: unknown): boolean {
  return readonlyToRaw.has(value)
}

export function toRaw<T>(observed: T): T {
  return reactiveToRaw.get(observed) || readonlyToRaw.get(observed) || observed
}

export function markReadonly<T>(value: T): T {
  readonlyValues.add(value)
  return value
}

export function markNonReactive<T>(value: T): T {
  nonReactiveValues.add(value)
  return value
}
