import { effect, ReactiveEffect, activeEffect } from './effect'
import { Ref, UnwrapRef } from './ref'
import { isFunction, NOOP } from '@vue/shared'

export interface ComputedRef<T = any> extends WritableComputedRef<T> {
  readonly value: UnwrapRef<T>
}

export interface WritableComputedRef<T> extends Ref<T> {
  readonly effect: ReactiveEffect<T>
}

export type ComputedGetter<T> = () => T
export type ComputedSetter<T> = (v: T) => void

export interface WritableComputedOptions<T> {
  get: ComputedGetter<T>
  set: ComputedSetter<T>
}

export function computed<T>(getter: ComputedGetter<T>): ComputedRef<T>
export function computed<T>(
  options: WritableComputedOptions<T>
): WritableComputedRef<T>

/**
 * @description 这个方法的思想跟2.0一致，也就是如果传进来的是一个方法，那么把这个方法作为调用getter方法的时候进行执行。
 * 如果传进来的是一个对象的引用的话，那么就直接指向这个对象的getter就可以了。
 * @param getterOrOptions
 */
export function computed<T>(
  getterOrOptions: ComputedGetter<T> | WritableComputedOptions<T>
) {
  let getter: ComputedGetter<T>
  let setter: ComputedSetter<T>

  if (isFunction(getterOrOptions)) {
    /**
     * 当计算属性定义成一个函数
     * getCount() {
     *   return this.a + this.b
     * }
     * 的时候就是执行这里，它没有setter方法
     */
    getter = getterOrOptions
    setter = __DEV__
      ? () => {
          console.warn('Write operation failed: computed value is readonly')
        }
      : NOOP
  } else {
    // 这里可以看作是一个代理其他对象（并不是proxy那种拦截式代理）
    getter = getterOrOptions.get
    setter = getterOrOptions.set
  }

  // dirty就是一个flag，下次调用getter的时候是否需要去执行求值操作
  let dirty = true
  let value: T

  const runner = effect(getter, {
    lazy: true,
    // mark effect as computed so that it gets priority during trigger
    computed: true,
    scheduler: () => {
      dirty = true
    }
  })

  // TODO 返回一个ref对象，是不是被代理过的数据都是ref类型的对象呢？（也就是数据、并且被代理过的，都会有这个标志）
  //  这也间接说明的computed是一个数据来着
  return {
    _isRef: true,
    // expose effect so computed can be stopped
    effect: runner,
    get value() {
      if (dirty) {
        // 惰性求值的精髓
        value = runner()
        dirty = false
      }
      // When computed effects are accessed in a parent effect, the parent should track all the dependencies the computed property has tracked.
      // 当在父级effect中访问计算的effect时，父级应该跟踪计算属性跟踪的所有依赖项
      // This should also apply for chained computed properties.
      trackChildRun(runner)
      return value
    },
    set value(newValue: T) {
      setter(newValue)
    }
  } as any
}

/**
 * @description 这个方法的作用是互相绑定依赖，也就是dep和effect之间的绑定
 * 是为了处理effect嵌套时候的调用问题，比如render中调用计算属性，那么render也要能够通过跟踪计算属性的依赖项来进行更新
 * @param childRunner
 */
function trackChildRun(childRunner: ReactiveEffect) {
  if (activeEffect === undefined) {
    return
  }
  for (let i = 0; i < childRunner.deps.length; i++) {
    const dep = childRunner.deps[i]
    if (!dep.has(activeEffect)) {
      // 这明显是互相绑定
      dep.add(activeEffect)
      activeEffect.deps.push(dep)
    }
  }
}
