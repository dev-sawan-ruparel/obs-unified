package obs

import "context"

// asContext narrows the type-erased Done() carrier passed to public
// StampInteraction/CurrentInteractionID signatures back to a
// context.Context. context.Context satisfies the carrier interface, so
// this is a no-op assertion in practice — it only exists to keep the
// public signatures free of an "context" import for callers that
// already pass r.Context() through.
//
// Internal helper; not part of the public API.
func asContext(c interface{ Done() <-chan struct{} }) context.Context {
	if ctx, ok := c.(context.Context); ok {
		return ctx
	}
	return context.Background()
}
