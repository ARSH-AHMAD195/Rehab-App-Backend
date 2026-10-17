import 'reflect-metadata';
import { ExecutionContext } from '@nestjs/common';
import { ROUTE_ARGS_METADATA } from '@nestjs/common/constants';
import { UnauthenticatedException } from '../api.exception';
import { CurrentUser } from './current-user.decorator';

/** Nest keeps a param decorator's factory in route-args metadata; pull it out to call it directly. */
function factoryOf(decorator: () => ParameterDecorator) {
  class Host {
    handler(@decorator() _user: unknown) {}
  }
  const args = Reflect.getMetadata(ROUTE_ARGS_METADATA, Host, 'handler');
  return args[Object.keys(args)[0]].factory as (data: unknown, ctx: ExecutionContext) => unknown;
}

const contextWith = (req: object) =>
  ({ switchToHttp: () => ({ getRequest: () => req }) }) as unknown as ExecutionContext;

describe('CurrentUser', () => {
  const factory = factoryOf(CurrentUser);

  it('returns the user the guard attached', () => {
    const user = { id: 'u1' };
    expect(factory(undefined, contextWith({ user }))).toBe(user);
  });

  it('is a 401, not a 500, on a route without the guard', () => {
    expect(() => factory(undefined, contextWith({}))).toThrow(UnauthenticatedException);
  });
});
