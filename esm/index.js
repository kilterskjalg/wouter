import { useBrowserLocation, useSearch as useSearch$1 } from './use-browser-location.js';
import { createContext, forwardRef, useEvent, isValidElement, cloneElement, createElement, useContext, useRef, useIsomorphicLayoutEffect, Fragment } from './react-deps.js';

/**
 * The function below was extracted from the `regexparam` package.
 * It has been modified to support optional wildcards, which is
 * addressed in this PR https://github.com/lukeed/regexparam/pull/25
 *
 * The original source code is distributed under the MIT license
 * and is available at: https://github.com/lukeed/regexparam
 *
 * Copyright: Luke Edwards
 */

function parse(str, loose) {
  if (str instanceof RegExp) return { keys: false, pattern: str };
  var c,
    o,
    tmp,
    ext,
    keys = [],
    pattern = "",
    arr = str.split("/");
  arr[0] || arr.shift();

  while ((tmp = arr.shift())) {
    c = tmp[0];
    if (c === "*") {
      o = tmp[1] === "?";
      keys.push("wild");
      pattern += o ? "(?:/(.*))?" : "/(.*)";
    } else if (c === ":") {
      o = tmp.indexOf("?", 1);
      ext = tmp.indexOf(".", 1);
      keys.push(tmp.substring(1, !!~o ? o : !!~ext ? ext : tmp.length));
      pattern += !!~o && !~ext ? "(?:/([^/]+?))?" : "/([^/]+?)";
      if (!!~ext) pattern += (!!~o ? "?" : "") + "\\" + tmp.substring(ext);
    } else {
      pattern += "/" + tmp;
    }
  }

  return {
    keys: keys,
    pattern: new RegExp("^" + pattern + (loose ? "(?=$|/)" : "/?$"), "i"),
  };
}

/*
 * Transforms `path` into its relative `base` version
 * If base isn't part of the path provided returns absolute path e.g. `~/app`
 */
const relativePath = (base = "", path) =>
  !path.toLowerCase().indexOf(base.toLowerCase())
    ? path.slice(base.length) || "/"
    : "~" + path;

const absolutePath = (to, base = "") =>
  to[0] === "~" ? to.slice(1) : base + to;

/*
 * Removes leading question mark
 */
const stripQm = (str) => (str[0] === "?" ? str.slice(1) : str);

/*
 * decodes escape sequences such as %20
 */
const unescape = (str) => {
  try {
    return decodeURIComponent(str);
  } catch (_e) {
    // fail-safe mode: if string can't be decoded do nothing
    return str;
  }
};

/*
 * Router and router context. Router is a lightweight object that represents the current
 * routing options: how location is managed, base path etc.
 *
 * There is a default router present for most of the use cases, however it can be overridden
 * via the <Router /> component.
 */

const defaultRouter = {
  hook: useBrowserLocation,
  searchHook: useSearch$1,
  parser: parse,
  base: "",
  // this option is used to override the current location during SSR
  ssrPath: undefined,
  ssrSearch: undefined,
};

const RouterCtx = createContext(defaultRouter);

// gets the closest parent router from the context
const useRouter = () => useContext(RouterCtx);

/**
 * Parameters context. Used by `useParams()` to get the
 * matched params from the innermost `Route` component.
 */

const ParamsCtx = createContext({});

const useParams = () => useContext(ParamsCtx);

/*
 * Part 1, Hooks API: useRoute and useLocation
 */

// Internal version of useLocation to avoid redundant useRouter calls

const useLocationFromRouter = (router) => {
  const [location, navigate] = router.hook(router);

  // the function reference should stay the same between re-renders, so that
  // it can be passed down as an element prop without any performance concerns.
  // (This is achieved via `useEvent`.)
  return [
    unescape(relativePath(router.base, location)),
    useEvent((to, navOpts) => navigate(absolutePath(to, router.base), navOpts)),
  ];
};

const useLocation = () => useLocationFromRouter(useRouter());

const useSearch = () => {
  const router = useRouter();
  return unescape(stripQm(router.searchHook(router)));
};

const matchRoute = (parser, route, path, loose) => {
  // falsy patterns mean this route "always matches"
  if (!route) return [true, {}];

  // when parser is in "loose" mode, `$base` is equal to the
  // first part of the route that matches the pattern
  // (e.g. for pattern `/a/:b` and path `/a/1/2/3` the `$base` is `a/1`)
  // we use this for route nesting
  const { pattern, keys } = parser(route, loose);
  const [$base, ...matches] = pattern.exec(path) || [];

  return $base !== undefined
    ? [
        true,

        // an object with parameters matched, e.g. { foo: "bar" } for "/:foo"
        // we "zip" two arrays here to construct the object
        // ["foo"], ["bar"] → { foo: "bar" }
        Object.fromEntries(keys.map((key, i) => [key, matches[i]])),

        // the third value if only present when parser is in "loose" mode,
        // so that we can extract the base path for nested routes
        ...(loose ? [$base] : []),
      ]
    : [false, null];
};

const useRoute = (pattern) =>
  matchRoute(useRouter().parser, pattern, useLocation()[0]);

/*
 * Part 2, Low Carb Router API: Router, Route, Link, Switch
 */

const Router = ({ children, ...props }) => {
  // the router we will inherit from - it is the closest router in the tree,
  // unless the custom `hook` is provided (in that case it's the default one)
  const parent_ = useRouter();
  const parent = props.hook ? defaultRouter : parent_;

  // holds to the context value: the router object
  let value = parent;

  // what is happening below: to avoid unnecessary rerenders in child components,
  // we ensure that the router object reference is stable, unless there are any
  // changes that require reload (e.g. `base` prop changes -> all components that
  // get the router from the context should rerender, even if the component is memoized).
  // the expected behaviour is:
  //
  //   1) when the resulted router is no different from the parent, use parent
  //   2) if the custom `hook` prop is provided, we always inherit from the
  //      default router instead. this resets all previously overridden options.
  //   3) when the router is customized here, it should stay stable between renders
  let ref = useRef({}),
    prev = ref.current,
    next = prev;

  for (let k in parent) {
    const option =
      k === "base"
        ? /* base is special case, it is appended to the parent's base */
          parent[k] + (props[k] || "")
        : props[k] || parent[k];

    if (prev === next && option !== next[k]) {
      ref.current = next = { ...next };
    }

    next[k] = option;

    // the new router is no different from the parent, use parent
    if (option !== parent[k]) value = next;
  }

  return createElement(RouterCtx.Provider, { value, children });
};

const h_route = ({ children, component }, params) => {
  // React-Router style `component` prop
  if (component) return createElement(component, { params });

  // support render prop or plain children
  return typeof children === "function" ? children(params) : children;
};

const Route = ({ path, nest, match, ...renderProps }) => {
  const router = useRouter();
  const [location] = useLocationFromRouter(router);

  const [matches, params, base] =
    // `match` is a special prop to give up control to the parent,
    // it is used by the `Switch` to avoid double matching
    match ?? matchRoute(router.parser, path, location, nest);

  if (!matches) return null;

  const children = base
    ? createElement(Router, { base }, h_route(renderProps, params))
    : h_route(renderProps, params);

  return createElement(ParamsCtx.Provider, { value: params, children });
};

const Link = forwardRef((props, ref) => {
  const router = useRouter();
  const [, navigate] = useLocationFromRouter(router);

  const {
    to,
    href: _href = to,
    onClick: _onClick,
    asChild,
    children,
    /* eslint-disable no-unused-vars */
    replace /* ignore nav props */,
    state /* ignore nav props */,
    /* eslint-enable no-unused-vars */
    ...restProps
  } = props;

  const onClick = useEvent((event) => {
    // ignores the navigation when clicked using right mouse button or
    // by holding a special modifier key: ctrl, command, win, alt, shift
    if (
      event.ctrlKey ||
      event.metaKey ||
      event.altKey ||
      event.shiftKey ||
      event.button !== 0
    )
      return;

    _onClick && _onClick(event); // TODO: is it safe to use _onClick?.(event)
    if (!event.defaultPrevented) {
      event.preventDefault();
      navigate(_href, props);
    }
  });

  // handle nested routers and absolute paths
  const href = _href[0] === "~" ? _href.slice(1) : router.base + _href;

  return asChild && isValidElement(children)
    ? cloneElement(children, { href, onClick })
    : createElement("a", { ...restProps, href, onClick, children, ref });
});

const flattenChildren = (children) => {
  return Array.isArray(children)
    ? [].concat(
        ...children.map((c) =>
          c && c.type === Fragment
            ? flattenChildren(c.props.children)
            : flattenChildren(c)
        )
      )
    : [children];
};

const Switch = ({ children, location }) => {
  const router = useRouter();
  const [originalLocation] = useLocationFromRouter(router);

  for (const element of flattenChildren(children)) {
    let match = 0;

    if (
      isValidElement(element) &&
      // we don't require an element to be of type Route,
      // but we do require it to contain a truthy `path` prop.
      // this allows to use different components that wrap Route
      // inside of a switch, for example <AnimatedRoute />.
      (match = matchRoute(
        router.parser,
        element.props.path,
        location || originalLocation,
        element.props.nest
      ))[0]
    )
      return cloneElement(element, { match });
  }

  return null;
};

const Redirect = (props) => {
  const { to, href = to } = props;
  const [, navigate] = useLocation();
  const redirect = useEvent(() => navigate(to || href, props));

  // redirect is guaranteed to be stable since it is returned from useEvent
  useIsomorphicLayoutEffect(() => {
    redirect();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return null;
};

export { Link, Redirect, Route, Router, Switch, useLocation, useParams, useRoute, useRouter, useSearch };
