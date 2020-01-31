/**
 * @description 说明了访问数组的方法会调触发到length的属性，从而被拦截下来
 * @type {{set(*, *): boolean, get(*=, *=, *): *}}
 */
// 进行验证数组的代理的splice等方法是否能够触发依赖,所以是能够代理到数组的所有方法和下标的
let handler = {
  get(target, key, receiver) {
    if (key === 'length') {
      console.log(key);
    }
    return Reflect.get(target, key);
  },
  set(target, key) {
    return true;
  }
};

let proxy = new Proxy([1, 2, 3, 4, 5], handler);

proxy.forEach(item => item);      // 这里会调用forEach、length、0，1， 2， 3 ，4 属性
proxy.map(item => item);
proxy.pop();
proxy.push();
proxy.slice();
proxy.splice();
proxy.every(item => item);
