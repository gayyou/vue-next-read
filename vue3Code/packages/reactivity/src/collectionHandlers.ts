import { toRaw, reactive, readonly } from './reactive'
import { track, trigger, ITERATE_KEY } from './effect'
import { TrackOpTypes, TriggerOpTypes } from './operations'
import { LOCKED } from './lock'
import { isObject, capitalize, hasOwn, hasChanged } from '@vue/shared'

export type CollectionTypes = IterableCollections | WeakCollections

/**
 * @description 这是针对于容器的代理handlers，对于容器，我们是不需要去监听容器的变化来进行显示的，而是要对容器的内容进行监听
 * 我们只需要对容器的方法进行监听，也就是说针对于容器，我们只需要代理拦截其get属性，也就是访问容器方法的时候进行检测以及代理拦截
 * 因为对于容器类习惯，是无法直接获得容器类型的
 */

type IterableCollections = Map<any, any> | Set<any>
type WeakCollections = WeakMap<any, any> | WeakSet<any>
type MapTypes = Map<any, any> | WeakMap<any, any>
type SetTypes = Set<any> | WeakSet<any>

const toReactive = <T extends unknown>(value: T): T =>
  isObject(value) ? reactive(value) : value

const toReadonly = <T extends unknown>(value: T): T =>
  isObject(value) ? readonly(value) : value

const getProto = <T extends CollectionTypes>(v: T): any =>
  Reflect.getPrototypeOf(v)

/**
 * @description 对Map类型的容器进行添加依赖，首先拿到Map中键值对的原生对象（而不是代理对象），然后再进行对象属性的跟踪，
 * 最后进行代理
 * @param target
 * @param key
 * @param wrap
 */
function get(
  target: MapTypes,
  key: unknown,
  wrap: typeof toReactive | typeof toReadonly
) {
  target = toRaw(target)
  key = toRaw(key)
  track(target, TrackOpTypes.GET, key)      // 对这个对象的key属性进行添加依赖
  return wrap(getProto(target).get.call(target, key))   // 返回代理的值的代理对象
}

function has(this: CollectionTypes, key: unknown): boolean {
  const target = toRaw(this)
  key = toRaw(key)
  track(target, TrackOpTypes.HAS, key)
  return getProto(target).has.call(target, key)
}

/**
 * @description 这里应该是对size进行监听，也就是对迭代器进行监听
 * @param target
 */
function size(target: IterableCollections) {
  target = toRaw(target)
  track(target, TrackOpTypes.ITERATE, ITERATE_KEY)
  return Reflect.get(getProto(target), 'size', target)
}

function add(this: SetTypes, value: unknown) {
  value = toRaw(value)
  const target = toRaw(this)
  const proto = getProto(target)
  const hadKey = proto.has.call(target, value)
  const result = proto.add.call(target, value)
  if (!hadKey) {
    /* istanbul ignore else */
    if (__DEV__) {
      trigger(target, TriggerOpTypes.ADD, value, { newValue: value })
    } else {
      trigger(target, TriggerOpTypes.ADD, value)
    }
  }
  return result
}

function set(this: MapTypes, key: unknown, value: unknown) {
  //
  value = toRaw(value)
  key = toRaw(key)
  const target = toRaw(this)
  const proto = getProto(target)      // 要用原型链上的对象进行添加，因为公共方法都是在原型上
  const hadKey = proto.has.call(target, key)
  const oldValue = proto.get.call(target, key)
  const result = proto.set.call(target, key, value)
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
      trigger(target, TriggerOpTypes.ADD, key)
    } else if (hasChanged(value, oldValue)) {
      trigger(target, TriggerOpTypes.SET, key)
    }
  }
  return result
}

function deleteEntry(this: CollectionTypes, key: unknown) {
  key = toRaw(key)
  const target = toRaw(this)
  const proto = getProto(target)
  const hadKey = proto.has.call(target, key)
  const oldValue = proto.get ? proto.get.call(target, key) : undefined
  // forward the operation before queueing reactions
  const result = proto.delete.call(target, key)
  if (hadKey) {
    /* istanbul ignore else */
    if (__DEV__) {
      trigger(target, TriggerOpTypes.DELETE, key, { oldValue })
    } else {
      trigger(target, TriggerOpTypes.DELETE, key)
    }
  }
  return result
}

function clear(this: IterableCollections) {
  const target = toRaw(this)
  const hadItems = target.size !== 0
  const oldTarget = __DEV__
    ? target instanceof Map
      ? new Map(target)
      : new Set(target)
    : undefined
  // forward the operation before queueing reactions
  // 在排队反应之前转发操作
  // TODO 这里进行清除操作，那么各种属性在deps中怎么进行处理呢？会不会是根本就不需要进行添加？（但是setter的时候会根据键值对得到原生对象）
  const result = getProto(target).clear.call(target)
  if (hadItems) {
    /* istanbul ignore else */
    if (__DEV__) {
      trigger(target, TriggerOpTypes.CLEAR, void 0, { oldTarget })
    } else {
      trigger(target, TriggerOpTypes.CLEAR)
    }
  }
  return result
}

function createForEach(isReadonly: boolean) {
  return function forEach(
    this: IterableCollections,
    callback: Function,
    thisArg?: unknown
  ) {
    const observed = this
    const target = toRaw(observed)
    const wrap = isReadonly ? toReadonly : toReactive
    track(target, TrackOpTypes.ITERATE, ITERATE_KEY)
    // important: create sure the callback is
    // 1. invoked with the reactive map as `this` and 3rd arg                 使用反应式Map“ this”和第三个参数调用
    // 2. the value received should be a corresponding reactive/readonly.     收到的值应该是相应的反应式/只读。
    function wrappedCallback(value: unknown, key: unknown) {
      return callback.call(observed, wrap(value), wrap(key), observed)
    }
    return getProto(target).forEach.call(target, wrappedCallback, thisArg)
  }
}

/**
 * @description 在这个方法是对迭代器进行监听
 * @param method
 * @param isReadonly
 */
function createIterableMethod(method: string | symbol, isReadonly: boolean) {
  return function(this: IterableCollections, ...args: unknown[]) {
    const target = toRaw(this)
    // 在遍历中，只有entries和迭代器在Map数据结构中会返回二维数组，其中第二维只有两个元素，分别是键和值，其他的values、keys都是只有一维数组
    const isPair =
      method === 'entries' ||
      (method === Symbol.iterator && target instanceof Map)
    const innerIterator = getProto(target)[method].apply(target, args)

    // warp就是根据条件来把它们进行封装成代理
    const wrap = isReadonly ? toReadonly : toReactive
    track(target, TrackOpTypes.ITERATE, ITERATE_KEY)        // 对迭代器进行监听
    // return a wrapped iterator which returns observed versions of the values emitted from the real iterator
    // 返回包装的迭代器，该迭代器返回从实际迭代器发出的值的观察版本
    return {
      // iterator protocol
      next() {0
        const { value, done } = innerIterator.next()
        return done
          ? { value, done }
          : {
              value: isPair ? [wrap(value[0]), wrap(value[1])] : wrap(value),
              done
            }
      },
      // iterable protocol
        [Symbol.iterator]() {
        return this
      }
    }
  }
}

function createReadonlyMethod(
  method: Function,
  type: TriggerOpTypes
): Function {
  return function(this: CollectionTypes, ...args: unknown[]) {
    if (LOCKED) {
      if (__DEV__) {
        const key = args[0] ? `on key "${args[0]}" ` : ``
        console.warn(
          `${capitalize(type)} operation ${key}failed: target is readonly.`,
          toRaw(this)
        )
      }
      return type === TriggerOpTypes.DELETE ? false : this
    } else {
      return method.apply(this, args)
    }
  }
}

/**
 * @description 可变容器的依赖添加配置项，最终会处理成一个handler的getter方法拦截。当访问容器的这些方法的时候，
 * 如果是依赖添加阶段的时候会进行依赖的添加。
 * 并且这个对象不仅仅有这几个方法，还有values、keys、entries、还有迭代标志方法
 */
const mutableInstrumentations: Record<string, Function> = {
  get(this: MapTypes, key: unknown) {
    return get(this, key, toReactive)
  },
  get size(this: IterableCollections) {
    return size(this)
  },
  has,
  add,
  set,
  delete: deleteEntry,
  clear,
  forEach: createForEach(false)
}

const readonlyInstrumentations: Record<string, Function> = {
  get(this: MapTypes, key: unknown) {
    return get(this, key, toReadonly)
  },
  get size(this: IterableCollections) {
    return size(this)
  },
  has,
  add: createReadonlyMethod(add, TriggerOpTypes.ADD),
  set: createReadonlyMethod(set, TriggerOpTypes.SET),
  delete: createReadonlyMethod(deleteEntry, TriggerOpTypes.DELETE),
  clear: createReadonlyMethod(clear, TriggerOpTypes.CLEAR),
  forEach: createForEach(true)
}

const iteratorMethods = ['keys', 'values', 'entries', Symbol.iterator]
iteratorMethods.forEach(method => {
  // 迭代方法在这里进行创建监听
  mutableInstrumentations[method as string] = createIterableMethod(
    method,
    false
  )
  readonlyInstrumentations[method as string] = createIterableMethod(
    method,
    true
  )
})

/**
 * @description 根据instrumenttations配置创建一个代理方法，返回Reflect反射
 */
function createInstrumentationGetter(
  instrumentations: Record<string, Function>
) {
  return (
    target: CollectionTypes,
    key: string | symbol,
    receiver: CollectionTypes
  ) =>
    Reflect.get(
      // instrumentattions只是作为方法载体进行提供方法。
      hasOwn(instrumentations, key) && key in target
        ? instrumentations
        : target,
      key,
      receiver
    )
}

export const mutableCollectionHandlers: ProxyHandler<CollectionTypes> = {
  get: createInstrumentationGetter(mutableInstrumentations)
}

export const readonlyCollectionHandlers: ProxyHandler<CollectionTypes> = {
  get: createInstrumentationGetter(readonlyInstrumentations)
}
