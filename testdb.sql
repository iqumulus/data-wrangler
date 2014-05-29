
create table foo (
    id int not null primary key,
    name varchar(32) not null
);

create table bar (
    id int not null primary key,
    foo_id int not null,
    rank int not null
);

insert into foo (id, name) values (1, 'bob'), (2, 'fred'), (3, 'jones');

insert into bar (id, foo_id, rank) values (4, 1, 1), (5, 1, 2), (6, 2, 5);

