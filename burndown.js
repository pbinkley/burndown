$.urlParam = function(name, url) {
    if (!url) {
     url = window.location.href;
    }
    var results = new RegExp('[\\?&]' + name + '=([^&#]*)').exec(url);
    if (!results) { 
        return undefined;
    }
    return results[1] || undefined;
}

var issuedata = {
    "closed": {"issues": 0, "points": 0},
    "wip": {"issues": 0, "points": 0},
    "ready": {"issues": 0, "points": 0}
}
$.fn.sort = function(){
    return this.pushStack([].sort.apply(this, arguments), []);
};

function sortByClosedAt(a, b){
    var date1 = !a.closed_at ? '1970-01-01T00:00:00Z' : a.closed_at;
    var date2 = !b.closed_at ? '1970-01-01T00:00:00Z' : b.closed_at;

    return date1 > date2 ? 1 : -1;
}

function showIssue(issue) {
    // build li element containing issue description
    // attach to appropriate ul in issues div
    var status;
    if (issue.closed_at)
        status="closed"
    else if (issue.assignee)
        status="wip"
    else status="ready";

    var li = $("<li>");
    if (issue.assignee) {
        li.append("<img class='avatar' " +
            "src='" + issue.assignee.avatar_url + "'" +
            "title='" + issue.assignee.login + "'" + 
            "></img>")
    }
    var a = $("<a href='" + issue.html_url + "'>");
    a.append(issue.number);
    li.append(a);
    li.append(": " + issue.title);

    for (var i = 0; i < issue.labels.length; i++) {
        li.append("<span class='label' style='background: #" + 
            issue.labels[i].color + "'>" +
            issue.labels[i].name) + "</span>";
    }

    $("#" + status).append(li);

    issuedata[status].issues += 1;
    issuedata[status].points += issue.burndown_points;

}

function showMilestone(owner, repo, milestone, config) {

    var perPage = 30,
    totalPages = 0,
    totalIssues = 0,
    totalPoints = 0,
    closedPoints = 0,
    numberOfClosedIssues = 0,
    numberOfOpenIssues = 0,
    actual = [], jsonData = [], issueData = [],
    ideal;

    // fetch milestone from GitHub API
    $.getJSON('https://api.github.com/repos/' + owner + '/' + repo + 
        '/issues?' + 
        '&state=all&sort=created&direction=asc&milestone=' + milestone, 
        function(data){

        // parse milestone
        jsonData = data.sort(sortByClosedAt);

        // count open and closed issues
        $.each(jsonData, function(i, item){
            if(!jsonData[i].closed_at)
                numberOfOpenIssues++;
            else
                numberOfClosedIssues++;
        });
        totalIssues = numberOfClosedIssues + numberOfOpenIssues;

        numberOfClosedIssues = 0; //reset in order to increment through
        milestonedata = null;

        // parse issues
        $.each(jsonData, function(i, item){
            if (milestonedata == null) {
                milestonedata = jsonData[i].milestone;
            }
            var points = config.defaultpoints;
            var labelnames = [];
            $.each (jsonData[i].labels, function(i, label){
                labelnames.push(label.name);
            });
            // lookup up size labels
            $.each (config.sizes, function(i, size) {
                if (labelnames.indexOf(size.label) > - 1) points = size.points;
                // this is how you break out of $.each
                return false;
            });
            jsonData[i].burndown_points = points;
            totalPoints += points;
            if(jsonData[i].closed_at){
                closedPoints += points;
                numberOfClosedIssues++;
                actual.push({date: new Date(jsonData[i].closed_at), points: closedPoints});
                issueData.push('#' + jsonData[i].number + ': ' + jsonData[i].title);
            }
            showIssue(jsonData[i]);
        });

        // update headings
        $("#h1").html(config.owner + '/' + config.repo + ": " + milestonedata.title);
        // add counts to column headers
        for (status in issuedata) {
            var data = issuedata[status];
            $("#" + status + "data").html("(" + data.issues + " issues, " 
                + data.points + " points)");
        }

        // prepare data for d3
        /*
        var ideal = [
            {date: new Date(2013, 1, 26), points: 50},
            // Fill in the rest of the points!
            {date: new Date(2013, 2, 8), points: 0}
        ];
        */
        end = new Date(milestonedata.due_on);
        end.setDate(end.getDate() + 1);
        start = new Date(milestonedata.due_on);
        start.setDate(start.getDate() - 11);

        // add starting point to actual line
        actual.splice(0, 0, {date: start, points: 0});

        // extend actual to now
        today = new Date(new Date().toISOString());
        lastpoints = actual[actual.length - 1].points;
        actual.push({date: today, points: lastpoints});

        // fill in values on ideal line, reflecting weekends when the line
        // does not go down.

        var cur = new Date(),
        isworkday = [],
        curPoints = totalPoints,
        workdays = 0,
        pointsPerDay = 0,
        ideal = [];

        // count workdays
        cur.setTime(start.getTime());
        while(cur <= end) {
            weekday = cur.getDay();
            datestring = cur.toISOString().substring(0, 10); // get yyyy-mm-dd
            // workdays: weekday is on workweek list and date is not on holidays list
            if ((config.workweek.indexOf(weekday) > -1) && (config.holidays.indexOf(datestring) == -1)) {
                workdays++;
                isworkday.push(true);
            }
            else
                isworkday.push(false);
            cur.setDate(cur.getDate() + 1);
        }

        pointsPerDay = totalPoints / workdays,

        // assign points to days for ideal line
        cur.setTime(start.getTime());
        i = 0;
        while(cur <= end) {
            ideal.push({date:new Date(cur.getTime()), points: curPoints});
            weekday = cur.getDay();
            datestring = cur.toISOString().substring(0, 10); // get yyyy-mm-dd
            if (isworkday[i])
                curPoints -= pointsPerDay;
            cur.setDate(cur.getDate() + 1);
            i += 1;
        }

        // lay out chart

        var margin = {top: 20, right: 20, bottom: 30, left: 50},
        width = 960 - margin.left - margin.right,
        height = 500 - margin.top - margin.bottom;
        var x = d3.time.scale()
        .range([0, width]);
        var y = d3.scale.linear()
        .range([height, 0]);


        var idealLine = d3.svg.line()
        .x(function(d) { return x(d.date); })
        .y(function(d) { return y(d.points); });
        var actualLine = d3.svg.line()
        .x(function(d) { return x(d.date); })
        .y(function(d) { return y(totalPoints - d.points); });

        x.domain(d3.extent(ideal, function(d){return d.date;}));
        y.domain([0, totalPoints]);

        function make_x_axis() {
            return d3.svg.axis()
            .scale(x)
            .orient("bottom")
            .tickFormat(d3.time.format("%a %e"))
        }

        function make_y_axis() {
            return d3.svg.axis()
            .scale(y)
            .orient("left");
        }

        var chart = d3.select("#chart").append("svg")
        .attr("class", "chart")
        .attr("width", width + margin.left + margin.right)
        .attr("height", height + margin.top + margin.bottom)
        .append("g")
        .attr("transform", "translate(" + margin.left + "," + margin.top + ")");

        // center the day labels under their column
        // based on http://stackoverflow.com/questions/17544546/d3-js-align-text-labels-between-ticks-on-the-axis/17544785#answer-17630938
        function adjustTextLabels(selection) {
            // remove last label (for the day after the end of the milestone)
            labels = selection.selectAll('.chart text');
            labels[0][labels[0].length - 1].remove();
            // transform remaining labels: move right 1/2 width of day column
            selection.selectAll('.chart text')
            .attr('transform', 'translate(' + daysToPixels(1) / 2 + ',0)');
        }

        // calculate the width of the days in the timeScale
        function daysToPixels(days, timeScale) {
            var d1 = new Date();
            return x(d3.time.day.offset(d1, days)) - x(d1);
        }

        chart.append("g")         
        .attr("class", "x axis")
        .attr("transform", "translate(0," + height + ")")
        .call(make_x_axis()
            .tickSize(-height, 0, 0)
            )
        .call(adjustTextLabels);     // adjusts text labels on the axis 

        chart.append("g")
        .attr("class", "y axis")
        .call(make_y_axis()
            .tickSize(-width, 0, 0)
            )
        .append("text")
        .attr("transform", "rotate(-90)")
        .attr("y", -40)
        .attr("dy", ".71em")
        .style("text-anchor", "end")
        .text("Points");

        // Paint the ideal line
        chart.append("path")
        .datum(ideal)
        .attr("class", "line ideal")
        .attr("d", idealLine);

        // Paint the actual line
        chart.append("path")
        .datum(actual)
        .attr("class", "line actual")
        .attr("d", actualLine);

    })

}

function showRepo(owner, repo) {
    var format = d3.time.format("%a, %e %b %Y");

    $.getJSON('https://api.github.com/repos/' + config.owner + '/' + config.repo + 
        '/milestones?state=open&sort=due_on&direction=desc', 
        function(data){
            // note: sorted on due date, descending - milestones without due dates sort to end
            var form = '<form method="GET" action="">' + 
                'Owner: <input type="text" name="owner" value="' + owner + '" readonly><br/>' + 
                'Repo: <input type="text" name="repo" value="' + repo + '" readonly><br/>' +
                '<ul>';
            $.each(data, function(i, milestone) {
                form += '<li><input type="radio" name="milestone" ' + ((i == 0) ? 'checked ' : '') +
                'value="' + milestone.number + '"/>';
                form += '<a href="' + milestone.html_url + '">' + milestone.title + "</a>";
                form += ' (' + milestone.open_issues + ' open, ' + milestone.closed_issues + ' closed)';
                if (milestone.due_on) {
                    var d = new Date(milestone.due_on);
                    form += ' (ends ' + format(d) + ')';
                }
                form += "</li>";
            });
            form += "</ul>";


               form += '<input type="submit" value="Submit"></form>';
            $("#chart").append($(form));
        }
    )
}

$(document).ready(function(){

    $.getJSON( "config.json", function( cfg ) {

        config = cfg;

        var owner = $.urlParam("owner");
        owner = (owner === undefined) ? config.owner : owner;
        var repo = $.urlParam("repo");
        repo = (repo === undefined) ? config.repo : repo;
        var milestone = $.urlParam("milestone");

        // we assume config has a default owner and repo - only question
        // is whether we have a milestone

        if (milestone)
            showMilestone(owner, repo, milestone, config);
        else
            showRepo(owner, repo);
    })

});
